import * as vscode from 'vscode';

interface QtErrorPattern {
    pattern: RegExp;
    title: (match: RegExpMatchArray) => string;
    createEdit: (document: vscode.TextDocument, diagnostic: vscode.Diagnostic, match: RegExpMatchArray) => vscode.WorkspaceEdit | undefined;
}

interface QtInfoPattern {
    pattern: RegExp;
    title: (match: RegExpMatchArray) => string;
}

export class QtCodeActionProvider implements vscode.CodeActionProvider {
    private outputChannel: vscode.OutputChannel;

    private static readonly errorPatterns: QtErrorPattern[] = [
        {
            pattern: /['"](Q[A-Z][a-zA-Z0-9]*)['"]\s*file not found/i,
            title: (match: RegExpMatchArray) => `Add #include <${match[1]}>`,
            createEdit: (document, diagnostic, match) => {
                const edit = new vscode.WorkspaceEdit();
                const className = match[1];
                const includeLine = `#include <${className}>`;
                
                const text = document.getText();
                const lines = text.split('\n');
                let insertLine = 0;
                
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim().startsWith('#include')) {
                        insertLine = i + 1;
                    }
                }
                
                if (text.includes(includeLine)) {
                    return undefined;
                }
                
                edit.insert(document.uri, new vscode.Position(insertLine, 0), includeLine + '\n');
                return edit;
            }
        },
        {
            pattern: /Q_OBJECT\s*must\s*appear/i,
            title: () => 'Add Q_OBJECT macro',
            createEdit: (document, diagnostic) => {
                const edit = new vscode.WorkspaceEdit();
                const line = diagnostic.range.start.line;
                
                for (let i = line; i < document.lineCount && i < line + 10; i++) {
                    const text = document.lineAt(i).text;
                    if (text.includes('{')) {
                        const indentMatch = text.match(/^(\s*)/);
                        const indent = indentMatch ? indentMatch[1] : '';
                        edit.insert(document.uri, new vscode.Position(i + 1, 0), `${indent}    Q_OBJECT\n`);
                        return edit;
                    }
                }
                return undefined;
            }
        },
        {
            pattern: /'qDebug'\s*was\s*not\s*declared/i,
            title: () => 'Add #include <QDebug>',
            createEdit: (document, diagnostic) => {
                const edit = new vscode.WorkspaceEdit();
                const includeLine = '#include <QDebug>';
                const text = document.getText();
                
                if (text.includes(includeLine)) {
                    return undefined;
                }
                
                const lines = text.split('\n');
                let insertLine = 0;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim().startsWith('#include')) {
                        insertLine = i + 1;
                    }
                }
                
                edit.insert(document.uri, new vscode.Position(insertLine, 0), includeLine + '\n');
                return edit;
            }
        }
    ];

    private static readonly infoPatterns: QtInfoPattern[] = [
        {
            pattern: /undefined\s*reference\s*to\s*[`']vtable\s*for\s*(\w+)/i,
            title: (match: RegExpMatchArray) => `Add Q_OBJECT to ${match[1]} or re-run qmake`
        }
    ];

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            const message = diagnostic.message;
            
            for (const pattern of QtCodeActionProvider.errorPatterns) {
                const match = message.match(pattern.pattern);
                if (match) {
                    const title = pattern.title(match);
                    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
                    action.diagnostics = [diagnostic];
                    action.edit = pattern.createEdit(document, diagnostic, match);
                    if (action.edit) {
                        actions.push(action);
                    }
                }
            }

            for (const pattern of QtCodeActionProvider.infoPatterns) {
                const match = message.match(pattern.pattern);
                if (match) {
                    const title = pattern.title(match);
                    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
                    action.diagnostics = [diagnostic];
                    action.command = {
                        command: 'qt.showInfoMessage',
                        title: title,
                        arguments: [title]
                    };
                    actions.push(action);
                }
            }
        }

        return actions;
    }
}
