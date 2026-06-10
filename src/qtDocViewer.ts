import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { QtConfigManager } from './qtConfigManager';

/**
 * Provides Qt offline documentation viewing via VS Code webview panels.
 * Detects local Qt HTML documentation and .qch files.
 */
export class QtDocViewer implements vscode.Disposable {
    private outputChannel: vscode.OutputChannel;
    private qtConfigManager: QtConfigManager;
    private panel?: vscode.WebviewPanel;

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
    }

    /**
     * Detect local Qt documentation directories.
     */
    async detectDocPaths(): Promise<string[]> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (!qtInstallation) { return []; }

        const paths: string[] = [];
        const candidates = [
            path.join(qtInstallation.path, 'doc', 'qt'),
            path.join(qtInstallation.path, 'Docs', 'Qt-' + (qtInstallation.version || '')),
            path.join(qtInstallation.path, 'Docs', 'Qt' + (qtInstallation.version || '').split('.')[0]),
            path.join(qtInstallation.path, 'docs'),
            path.join(path.dirname(qtInstallation.path), 'Docs', 'Qt-' + (qtInstallation.version || '')),
        ];

        for (const p of candidates) {
            if (fs.existsSync(p)) {
                paths.push(p);
            }
        }

        return paths;
    }

    /**
     * Find the HTML index file for a Qt module.
     */
    async findModuleIndex(moduleName: string): Promise<string | undefined> {
        const docPaths = await this.detectDocPaths();
        for (const docPath of docPaths) {
            const indexPath = path.join(docPath, `${moduleName.toLowerCase()}`, 'index.html');
            if (fs.existsSync(indexPath)) { return indexPath; }
            const altPath = path.join(docPath, `${moduleName.toLowerCase()}.html`);
            if (fs.existsSync(altPath)) { return altPath; }
        }
        return undefined;
    }

    /**
     * Open the Qt Documentation viewer.
     */
    async openDocViewer(): Promise<void> {
        const docPaths = await this.detectDocPaths();
        if (docPaths.length === 0) {
            void vscode.window.showInformationMessage(
                'No local Qt documentation found. Install Qt documentation or use online docs at doc.qt.io.',
                'Open Online Docs'
            ).then(choice => {
                if (choice === 'Open Online Docs') {
                    void vscode.env.openExternal(vscode.Uri.parse('https://doc.qt.io'));
                }
            });
            return;
        }

        // List available modules
        const modules: { label: string; description: string; indexPath: string }[] = [];
        const seen = new Set<string>();

        for (const docPath of docPaths) {
            try {
                const entries = fs.readdirSync(docPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const indexPath = path.join(docPath, entry.name, 'index.html');
                        if (fs.existsSync(indexPath) && !seen.has(entry.name)) {
                            seen.add(entry.name);
                            modules.push({
                                label: entry.name,
                                description: path.relative(docPath, indexPath),
                                indexPath
                            });
                        }
                    } else if (entry.name.endsWith('.html') && !seen.has(entry.name.replace('.html', ''))) {
                        const name = entry.name.replace('.html', '');
                        seen.add(name);
                        modules.push({
                            label: name,
                            description: path.relative(docPath, path.join(docPath, entry.name)),
                            indexPath: path.join(docPath, entry.name)
                        });
                    }
                }
            } catch {
                // ignore unreadable dirs
            }
        }

        if (modules.length === 0) {
            void vscode.window.showInformationMessage('No Qt documentation modules found locally.');
            return;
        }

        modules.sort((a, b) => a.label.localeCompare(b.label));

        const selected = await vscode.window.showQuickPick(
            modules.map(m => ({ label: m.label, description: m.description, indexPath: m.indexPath })),
            { placeHolder: 'Select Qt documentation module' }
        );

        if (!selected) { return; }
        this.showWebview(selected.label, selected.indexPath);
    }

    /**
     * Open documentation for a specific class or method in a webview.
     */
    async openDocFor(symbol: string): Promise<void> {
        const docPaths = await this.detectDocPaths();
        if (docPaths.length === 0) {
            // Fall back to online docs
            void vscode.env.openExternal(vscode.Uri.parse(`https://doc.qt.io/qt-6/search-results.html?q=${encodeURIComponent(symbol)}`));
            return;
        }

        // Search for symbol in local docs
        for (const docPath of docPaths) {
            const candidates = [
                path.join(docPath, `${symbol.toLowerCase()}.html`),
                path.join(docPath, 'q', `${symbol.toLowerCase()}.html`),
                path.join(docPath, symbol.toLowerCase(), 'index.html'),
            ];
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                    this.showWebview(symbol, candidate);
                    return;
                }
            }
        }

        // Not found locally — fallback to online
        void vscode.env.openExternal(vscode.Uri.parse(`https://doc.qt.io/qt-6/search-results.html?q=${encodeURIComponent(symbol)}`));
    }

    private showWebview(title: string, filePath: string): void {
        if (this.panel) {
            this.panel.dispose();
        }

        const column = vscode.ViewColumn.Beside;
        this.panel = vscode.window.createWebviewPanel(
            'qtDocViewer',
            `Qt Docs: ${title}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.dirname(filePath))]
            }
        );

        const content = fs.readFileSync(filePath, 'utf-8');
        const dirUri = this.panel.webview.asWebviewUri(vscode.Uri.file(path.dirname(filePath)));

        // Rewrite relative URLs to use webview URI scheme
        const rewritten = content
            .replace(/src="([^"]+)"/g, (_m, src: string) => {
                if (src.startsWith('http') || src.startsWith('data:')) { return `src="${src}"`; }
                return `src="${dirUri}/${src.replace(/^\.\//, '').replace(/^\//, '')}"`;
            })
            .replace(/href="([^"]+)"/g, (_m, href: string) => {
                if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) {
                    return `href="${href}"`;
                }
                return `href="${dirUri}/${href.replace(/^\.\//, '').replace(/^\//, '')}"`;
            });

        this.panel.webview.html = rewritten;

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    dispose(): void {
        if (this.panel) {
            this.panel.dispose();
        }
    }
}
