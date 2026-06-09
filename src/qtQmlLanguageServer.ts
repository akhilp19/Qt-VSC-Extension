import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';
import { QtConfigManager } from './qtConfigManager';

export class QtQmlLanguageServer {
    private client?: LanguageClient;
    private outputChannel: vscode.OutputChannel;
    private qtConfigManager: QtConfigManager;
    private disposables: vscode.Disposable[] = [];

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
    }

    /**
     * Try to start the qmlls language server if available.
     * Returns true if started successfully.
     */
    async start(importPaths: string[] = []): Promise<boolean> {
        // Stop any existing client first
        await this.stop();

        const qmllsPath = await this.findQmlls();
        if (!qmllsPath) {
            this.outputChannel.appendLine('[qmlls] Not found. QML Language Server requires Qt 6.2+. Falling back to built-in QML providers.');
            return false;
        }

        try {
            // Build server options
            const args: string[] = [];
            for (const importPath of importPaths) {
                args.push('-I', importPath);
            }

            const serverOptions = {
                command: qmllsPath,
                args,
                transport: TransportKind.stdio
            };

            const clientOptions = {
                documentSelector: [
                    { scheme: 'file', language: 'qml' },
                    { scheme: 'file', pattern: '**/*.qml' }
                ],
                synchronize: {
                    fileEvents: vscode.workspace.createFileSystemWatcher('**/*.qml')
                },
                outputChannel: this.outputChannel
            };

            this.client = new LanguageClient(
                'qt-qmlls',
                'Qt QML Language Server',
                serverOptions,
                clientOptions
            );

            this.outputChannel.appendLine(`[qmlls] Starting: ${qmllsPath} ${args.join(' ')}`);
            await this.client.start();
            this.outputChannel.appendLine('[qmlls] Started successfully');
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`[qmlls] Failed to start: ${String(error)}`);
            this.client = undefined;
            return false;
        }
    }

    /**
     * Stop the language server client.
     */
    async stop(): Promise<void> {
        if (this.client) {
            try {
                await this.client.stop();
                this.outputChannel.appendLine('[qmlls] Stopped');
            } catch (error) {
                this.outputChannel.appendLine(`[qmlls] Error stopping: ${String(error)}`);
            }
            this.client = undefined;
        }
    }

    /**
     * Restart the language server with updated import paths.
     */
    async restart(importPaths: string[] = []): Promise<boolean> {
        await this.stop();
        return this.start(importPaths);
    }

    /**
     * Check if qmlls is currently running.
     */
    isRunning(): boolean {
        return this.client !== undefined && this.client.isRunning();
    }

    /**
     * Find the qmlls executable in Qt bin directory or PATH.
     */
    private async findQmlls(): Promise<string | undefined> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (qtInstallation) {
            const qtBinPath = path.join(qtInstallation.path, 'bin');
            const candidates = ['qmlls', 'qmlls.exe'];
            for (const name of candidates) {
                const p = path.join(qtBinPath, name);
                if (fs.existsSync(p)) {
                    return p;
                }
            }
        }

        // Fallback to PATH
        try {
            const cmd = process.platform === 'win32' ? 'where qmlls' : 'which qmlls';
            const result = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            const first = result.split('\n')[0].trim();
            if (first && fs.existsSync(first)) {
                return first;
            }
        } catch {
            // not in PATH
        }

        return undefined;
    }

    dispose(): void {
        void this.stop();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}
