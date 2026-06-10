import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { findQtClass, searchQtMethods, QT_MACROS } from './qtApiData';
import { QtConfigManager } from './qtConfigManager';

export class QtHoverProvider implements vscode.HoverProvider {
    private outputChannel: vscode.OutputChannel;
    private qtConfigManager: QtConfigManager;

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
    }

    private async detectLocalDoc(className: string): Promise<string | undefined> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (!qtInstallation) { return undefined; }

        const candidates = [
            path.join(qtInstallation.path, 'doc', 'qt', `${className.toLowerCase()}.html`),
            path.join(qtInstallation.path, 'Docs', `Qt-${qtInstallation.version || ''}`, `${className.toLowerCase()}.html`),
            path.join(qtInstallation.path, 'Docs', `Qt${(qtInstallation.version || '').split('.')[0]}`, `${className.toLowerCase()}.html`),
            path.join(qtInstallation.path, 'docs', `${className.toLowerCase()}.html`),
        ];

        for (const p of candidates) {
            if (fs.existsSync(p)) { return vscode.Uri.file(p).toString(); }
        }
        return undefined;
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_]+/);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);

        // Check if it's a Qt class
        const cls = findQtClass(word);
        if (cls) {
            const contents = new vscode.MarkdownString();
            contents.appendCodeblock(`#include <${cls.header}>`, 'cpp');
            contents.appendMarkdown(`\n**${cls.name}**`);
            if (cls.inherits) {
                contents.appendMarkdown(` — inherits \`${cls.inherits}\``);
            }
            contents.appendMarkdown(`\n\n${cls.description}\n\n`);
            const localDoc = await this.detectLocalDoc(cls.name);
            if (localDoc) {
                contents.appendMarkdown(`[📖 View Local Documentation](${localDoc})`);
            } else {
                contents.appendMarkdown(`[📖 View Qt Documentation](${cls.docUrl})`);
            }
            return new vscode.Hover(contents, wordRange);
        }

        // Check if it's a Qt macro
        const macro = QT_MACROS.find(m => m.name === word);
        if (macro) {
            const contents = new vscode.MarkdownString();
            contents.appendMarkdown(`**${macro.name}** — Qt Macro\n\n${macro.description}`);
            return new vscode.Hover(contents, wordRange);
        }

        // Check if it's a method call - look for ClassName::method or object->method
        const lineText = document.lineAt(position).text;
        const methodMatch = lineText.match(new RegExp(`(\\b[A-Z][a-zA-Z0-9_]*)\\s*(?:->|\\.)\\s*${word}\\b`));
        if (methodMatch) {
            const className = methodMatch[1];
            const methods = searchQtMethods(className, word);
            if (methods.length > 0) {
                const m = methods[0];
                const cls = findQtClass(className);
                const contents = new vscode.MarkdownString();
                contents.appendCodeblock(`${m.signature}`, 'cpp');
                contents.appendMarkdown(`\n**${className}::${m.name}**`);
                if (m.isSignal) { contents.appendMarkdown(` *(signal)*`); }
                if (m.isSlot) { contents.appendMarkdown(` *(slot)*`); }
                if (m.isStatic) { contents.appendMarkdown(` *(static)*`); }
                contents.appendMarkdown(`\n\n${m.description}`);
                if (cls) {
                    const localDoc = await this.detectLocalDoc(cls.name);
                    if (localDoc) {
                        contents.appendMarkdown(`\n\n[📖 View Local Documentation](${localDoc})`);
                    } else {
                        contents.appendMarkdown(`\n\n[📖 View Documentation](${cls.docUrl}#${m.name})`);
                    }
                }
                return new vscode.Hover(contents, wordRange);
            }
        }

        return undefined;
    }
}
