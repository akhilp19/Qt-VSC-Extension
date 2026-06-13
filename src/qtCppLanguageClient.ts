import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import { QtConfigManager } from './qtConfigManager';

export class QtCppLanguageClient {
    private client?: LanguageClient;
    private outputChannel: vscode.OutputChannel;
    private qtConfigManager: QtConfigManager;
    private disposables: vscode.Disposable[] = [];

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
    }

    dispose(): void {
        void this.stop();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }

    async start(includePaths: string[] = []): Promise<boolean> {
        await this.stop();

        const config = vscode.workspace.getConfiguration('qt');
        if (config.get<boolean>('cppLspEnable') === false) {
            this.outputChannel.appendLine('[Qt C++ LSP] Disabled by setting qt.cppLspEnable=false');
            return false;
        }

        const serverPath = this.findServerScript();
        if (!serverPath) {
            this.outputChannel.appendLine('[Qt C++ LSP] Server script not found. Expected out/qtCppLanguageServer.js');
            return false;
        }

        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        const qtInclude = qtInstallation ? path.join(qtInstallation.path, 'include') : undefined;
        const allIncludes = qtInclude ? [qtInclude, ...includePaths] : includePaths;

        const serverOptions: ServerOptions = {
            run: { module: serverPath, transport: TransportKind.stdio },
            debug: { module: serverPath, transport: TransportKind.stdio, options: { execArgv: ['--nolazy', '--inspect=6010'] } }
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: [
                { scheme: 'file', language: 'cpp' },
                { scheme: 'file', pattern: '**/*.{cpp,h,hpp,c}' }
            ],
            synchronize: {
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{cpp,h,hpp,c}')
            },
            outputChannel: this.outputChannel,
            initializationOptions: {
                qtIncludePath: qtInclude,
                diagnosticsEnabled: config.get<boolean>('cppLspDiagnosticsEnable') ?? true,
                includePaths: allIncludes,
                mocIntelliSenseV2Enabled: config.get<boolean>('mocIntelliSenseV2Enabled') ?? true
            }
        };

        this.client = new LanguageClient(
            'qt-cpp-lsp',
            'Qt C++ Language Server',
            serverOptions,
            clientOptions
        );

        this.outputChannel.appendLine(`[Qt C++ LSP] Starting: ${serverPath}`);
        try {
            await this.client.start();
            this.outputChannel.appendLine('[Qt C++ LSP] Started successfully');
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`[Qt C++ LSP] Failed to start: ${error}`);
            this.client = undefined;
            return false;
        }
    }

    async stop(): Promise<void> {
        if (this.client) {
            try {
                await this.client.stop();
            } catch (error) {
                this.outputChannel.appendLine(`[Qt C++ LSP] Stop error: ${error}`);
            }
            this.client = undefined;
        }
    }

    async restart(includePaths: string[] = []): Promise<boolean> {
        await this.stop();
        return this.start(includePaths);
    }

    isRunning(): boolean {
        return this.client !== undefined && this.client.isRunning();
    }

    private findServerScript(): string | undefined {
        const config = vscode.workspace.getConfiguration('qt');
        const configuredPath = config.get<string>('cppLspServerPath');
        if (configuredPath && fs.existsSync(configuredPath)) {
            return configuredPath;
        }

        const candidates = [
            path.join(__dirname, 'qtCppLanguageServer.js'),
            path.join(__dirname, '..', 'out', 'qtCppLanguageServer.js'),
            path.join(process.cwd(), 'out', 'qtCppLanguageServer.js')
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }
}
