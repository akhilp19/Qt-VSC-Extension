import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';

const TELEMETRY_FILE = 'qt-telemetry.json';
const MAX_QUEUE_SIZE = 1000;
const FLUSH_THRESHOLD = 50;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

export interface TelemetryEvent {
    type: 'command' | 'build' | 'activation' | 'feature' | 'error';
    name: string;
    timestamp: number;
    platform: string;
    extensionVersion: string;
    durationMs?: number;
    success?: boolean;
    value?: number | boolean;
}

/**
 * Privacy-first, opt-in telemetry service.
 *
 * - Disabled by default.
 * - Collects only anonymous event metadata (no file paths, project names, or code).
 * - Stores events locally in the extension's global storage.
 * - Optionally flushes to a configured HTTPS endpoint.
 */
export class QtTelemetry implements vscode.Disposable {
    private context: vscode.ExtensionContext;
    private outputChannel: vscode.OutputChannel;
    private queue: TelemetryEvent[] = [];
    private flushTimer?: NodeJS.Timeout;
    private storagePath: string;

    constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.outputChannel = outputChannel;
        this.storagePath = path.join(context.globalStorageUri.fsPath, TELEMETRY_FILE);
        this.loadQueue();
        this.startFlushTimer();
    }

    /**
     * Check whether telemetry collection is enabled.
     */
    isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('qt');
        return config.get<boolean>('telemetryEnabled') ?? false;
    }

    /**
     * Record a Qt command invocation.
     */
    trackCommand(commandId: string): void {
        if (!commandId.startsWith('qt.')) { return; }
        this.push({
            type: 'command',
            name: commandId,
            timestamp: Date.now(),
            platform: process.platform,
            extensionVersion: this.getExtensionVersion()
        });
    }

    /**
     * Record a build task outcome.
     */
    trackBuild(taskType: string, durationMs: number, success: boolean): void {
        this.push({
            type: 'build',
            name: taskType,
            timestamp: Date.now(),
            platform: process.platform,
            extensionVersion: this.getExtensionVersion(),
            durationMs,
            success
        });
    }

    /**
     * Record extension activation.
     */
    trackActivation(): void {
        this.push({
            type: 'activation',
            name: 'activate',
            timestamp: Date.now(),
            platform: process.platform,
            extensionVersion: this.getExtensionVersion()
        });
    }

    /**
     * Record a feature flag / setting snapshot.
     */
    trackFeature(featureKey: string, value: boolean | number): void {
        this.push({
            type: 'feature',
            name: featureKey,
            timestamp: Date.now(),
            platform: process.platform,
            extensionVersion: this.getExtensionVersion(),
            value
        });
    }

    /**
     * Record an error event (no stack traces or messages).
     */
    trackError(errorCode: string): void {
        this.push({
            type: 'error',
            name: errorCode,
            timestamp: Date.now(),
            platform: process.platform,
            extensionVersion: this.getExtensionVersion()
        });
    }

    /**
     * Show a one-time opt-in prompt. Re-appears after each extension update until the user makes a choice.
     */
    async showOptInPrompt(): Promise<void> {
        const currentVersion = this.getExtensionVersion();
        const promptedVersion = this.context.globalState.get<string>('qt.telemetryPromptVersion');
        if (promptedVersion === currentVersion) {
            return;
        }

        const choice = await vscode.window.showInformationMessage(
            'Help improve Qt C++ Tools by sending anonymous usage telemetry? You can change this anytime in settings.',
            'Enable',
            'Disable',
            'Later'
        );

        if (choice === 'Enable' || choice === 'Disable') {
            const config = vscode.workspace.getConfiguration('qt');
            await config.update('telemetryEnabled', choice === 'Enable', vscode.ConfigurationTarget.Global);
            this.outputChannel.appendLine(`[Telemetry] User opted ${choice === 'Enable' ? 'in' : 'out'} of telemetry`);
        }

        await this.context.globalState.update('qt.telemetryPromptVersion', currentVersion);
    }

    /**
     * Open the telemetry setting in the VS Code settings UI.
     */
    async configureTelemetry(): Promise<void> {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'qt.telemetryEnabled');
    }

    /**
     * Export the queued telemetry events to a JSON file.
     */
    async exportTelemetry(targetUri?: vscode.Uri): Promise<void> {
        let uri = targetUri;
        if (!uri) {
            const picked = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('qt-telemetry.json'),
                filters: { 'JSON': ['json'] }
            });
            if (!picked) { return; }
            uri = picked;
        }

        try {
            const content = JSON.stringify(this.queue, null, 2);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
            void vscode.window.showInformationMessage(`Exported ${this.queue.length} telemetry event(s) to ${uri.fsPath}`);
            this.outputChannel.appendLine(`[Telemetry] Exported ${this.queue.length} event(s) to ${uri.fsPath}`);
        } catch (error) {
            void vscode.window.showErrorMessage(`Failed to export telemetry: ${error}`);
            this.outputChannel.appendLine(`[Telemetry] Export failed: ${error}`);
        }
    }

    /**
     * Flush queued events to the configured endpoint, if any.
     */
    async flush(): Promise<void> {
        if (!this.isEnabled()) { return; }

        const config = vscode.workspace.getConfiguration('qt');
        const endpoint = config.get<string>('telemetryEndpoint') ?? '';
        if (!endpoint) { return; }

        const events = [...this.queue];
        if (events.length === 0) { return; }

        try {
            await this.postEvents(endpoint, events);
            this.queue = [];
            await this.saveQueue();
            this.outputChannel.appendLine(`[Telemetry] Flushed ${events.length} event(s) to endpoint`);
        } catch (error) {
            this.outputChannel.appendLine(`[Telemetry] Flush failed: ${error}`);
        }
    }

    dispose(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    private push(event: TelemetryEvent): void {
        if (!this.isEnabled()) { return; }

        this.queue.push(event);
        if (this.queue.length > MAX_QUEUE_SIZE) {
            this.queue = this.queue.slice(-MAX_QUEUE_SIZE);
        }

        void this.saveQueue();

        if (this.queue.length >= FLUSH_THRESHOLD) {
            void this.flush();
        }
    }

    private loadQueue(): void {
        try {
            if (!fs.existsSync(this.storagePath)) {
                this.queue = [];
                return;
            }
            const content = fs.readFileSync(this.storagePath, 'utf-8');
            this.queue = JSON.parse(content) as TelemetryEvent[];
        } catch (error) {
            this.outputChannel.appendLine(`[Telemetry] Failed to load queue: ${error}`);
            this.queue = [];
        }
    }

    private async saveQueue(): Promise<void> {
        try {
            const dir = path.dirname(this.storagePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.storagePath, JSON.stringify(this.queue, null, 2), 'utf-8');
        } catch (error) {
            this.outputChannel.appendLine(`[Telemetry] Failed to save queue: ${error}`);
        }
    }

    private startFlushTimer(): void {
        if (this.flushTimer) { return; }
        this.flushTimer = setInterval(() => {
            void this.flush();
        }, FLUSH_INTERVAL_MS);
    }

    private getExtensionVersion(): string {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pkg = require('../package.json');
        return pkg.version as string;
    }

    private postEvents(endpoint: string, events: TelemetryEvent[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint);
            const data = Buffer.from(JSON.stringify(events), 'utf-8');
            const options = {
                method: 'POST',
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                }
            };

            const request = endpoint.startsWith('https')
                ? https.request(options, res => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}`));
                    }
                })
                : http.request(options, res => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}`));
                    }
                });

            request.on('error', reject);
            request.write(data);
            request.end();
        });
    }
}
