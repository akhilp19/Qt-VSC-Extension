import * as vscode from 'vscode';
import {
    QT_CLASSES,
    QT_MACROS,
    findQtClass,
    searchQtClasses,
    searchQtMethods,
    searchQtMacros
} from './qtApiData';

export class QtCompletionProvider implements vscode.CompletionItemProvider {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const lineText = document.lineAt(position).text;
        const textBeforeCursor = lineText.substring(0, position.character);

        const items: vscode.CompletionItem[] = [];

        // Detect connect() context
        if (this.isInsideConnect(lineText, position.character)) {
            items.push(...this.getConnectCompletions());
            return items;
        }

        // Detect after -> or . for method completion
        const memberAccessMatch = textBeforeCursor.match(/(\b[A-Z][a-zA-Z0-9_]*)\s*(?:->|\.)\s*([a-zA-Z_]*)$/);
        if (memberAccessMatch) {
            const className = memberAccessMatch[1];
            const methodPrefix = memberAccessMatch[2];
            items.push(...this.getMethodCompletions(className, methodPrefix));
            return items;
        }

        // Detect inside class declaration for Q_OBJECT / signals / slots
        if (this.isInsideClassDeclaration(document, position)) {
            items.push(...this.getClassDeclarationCompletions());
        }

        // General Qt class and macro completions
        const wordMatch = textBeforeCursor.match(/\b([a-zA-Z_]*)$/);
        const prefix = wordMatch ? wordMatch[1] : '';

        items.push(...this.getClassCompletions(prefix));
        items.push(...this.getMacroCompletions(prefix));

        return items;
    }

    private isInsideConnect(lineText: string, cursorPos: number): boolean {
        const textBefore = lineText.substring(0, cursorPos);
        return /\bconnect\s*\([^)]*$/.test(textBefore);
    }

    private isInsideClassDeclaration(document: vscode.TextDocument, position: vscode.Position): boolean {
        // Simple heuristic: look for "class" keyword above current line
        for (let i = position.line - 1; i >= 0 && i >= position.line - 30; i--) {
            const line = document.lineAt(i).text;
            if (/^\s*class\s+\w+/.test(line)) {
                return true;
            }
            if (/^\s*\};?\s*$/.test(line) && !line.includes('{')) {
                return false;
            }
        }
        return false;
    }

    private getConnectCompletions(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // SIGNAL macro completion
        const signalItem = new vscode.CompletionItem('SIGNAL', vscode.CompletionItemKind.Keyword);
        signalItem.insertText = new vscode.SnippetString('SIGNAL(${1:signal}(${2:args}))');
        signalItem.documentation = new vscode.MarkdownString('Qt SIGNAL macro for connect().');
        items.push(signalItem);

        // SLOT macro completion
        const slotItem = new vscode.CompletionItem('SLOT', vscode.CompletionItemKind.Keyword);
        slotItem.insertText = new vscode.SnippetString('SLOT(${1:slot}(${2:args}))');
        slotItem.documentation = new vscode.MarkdownString('Qt SLOT macro for connect().');
        items.push(slotItem);

        // this completion for receiver
        const thisItem = new vscode.CompletionItem('this', vscode.CompletionItemKind.Keyword);
        thisItem.documentation = 'Use this object as the receiver.';
        items.push(thisItem);

        // Common connection patterns
        const lambdaItem = new vscode.CompletionItem('lambda', vscode.CompletionItemKind.Snippet);
        lambdaItem.insertText = new vscode.SnippetString('[=]() {\n\t${1:// handle signal}\n}');
        lambdaItem.documentation = 'Lambda function as slot.';
        items.push(lambdaItem);

        return items;
    }

    private getMethodCompletions(className: string, prefix: string): vscode.CompletionItem[] {
        const cls = findQtClass(className);
        if (!cls) {
            return [];
        }

        const methods = prefix ? searchQtMethods(className, prefix) : cls.methods;
        return methods.map(m => {
            const item = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.Method);
            item.detail = `${cls.name}::${m.signature}`;
            item.documentation = new vscode.MarkdownString(
                `${m.description}\n\n` +
                `**Signature:** \`${m.signature}\`\n\n` +
                `[View Documentation](${cls.docUrl}#${m.name})`
            );
            item.insertText = new vscode.SnippetString(`${m.name}($0)`);

            if (m.isSignal) {
                item.kind = vscode.CompletionItemKind.Event;
            } else if (m.isSlot) {
                item.kind = vscode.CompletionItemKind.Method;
            }

            return item;
        });
    }

    private getClassCompletions(prefix: string): vscode.CompletionItem[] {
        const classes = prefix ? searchQtClasses(prefix) : QT_CLASSES;
        return classes.map(c => {
            const item = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Class);
            item.detail = c.inherits ? `inherits ${c.inherits}` : 'Qt Class';
            item.documentation = new vscode.MarkdownString(
                `${c.description}\n\n` +
                `**Header:** \`<${c.header}>\`\n\n` +
                `[View Documentation](${c.docUrl})`
            );
            return item;
        });
    }

    private getMacroCompletions(prefix: string): vscode.CompletionItem[] {
        const macros = prefix ? searchQtMacros(prefix) : QT_MACROS;
        return macros.map(m => {
            const item = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.Keyword);
            item.detail = 'Qt Macro';
            item.documentation = new vscode.MarkdownString(m.description);
            if (m.snippet) {
                item.insertText = new vscode.SnippetString(m.snippet);
            }
            return item;
        });
    }

    private getClassDeclarationCompletions(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        const qObject = new vscode.CompletionItem('Q_OBJECT', vscode.CompletionItemKind.Keyword);
        qObject.documentation = 'Must appear in private section of classes with signals/slots.';
        items.push(qObject);

        const signalsMacro = new vscode.CompletionItem('signals:', vscode.CompletionItemKind.Keyword);
        signalsMacro.documentation = 'Marks subsequent methods as signals.';
        items.push(signalsMacro);

        const slotsMacro = new vscode.CompletionItem('private slots:', vscode.CompletionItemKind.Keyword);
        slotsMacro.documentation = 'Marks subsequent methods as private slots.';
        items.push(slotsMacro);

        const publicSlots = new vscode.CompletionItem('public slots:', vscode.CompletionItemKind.Keyword);
        publicSlots.documentation = 'Marks subsequent methods as public slots.';
        items.push(publicSlots);

        const protectedSlots = new vscode.CompletionItem('protected slots:', vscode.CompletionItemKind.Keyword);
        protectedSlots.documentation = 'Marks subsequent methods as protected slots.';
        items.push(protectedSlots);

        const qProperty = new vscode.CompletionItem('Q_PROPERTY', vscode.CompletionItemKind.Keyword);
        qProperty.insertText = new vscode.SnippetString('Q_PROPERTY(${1:type} ${2:name} READ ${3:getter} WRITE ${4:setter} NOTIFY ${5:changed})');
        qProperty.documentation = 'Declares a property in a QObject-derived class.';
        items.push(qProperty);

        const qInvokable = new vscode.CompletionItem('Q_INVOKABLE', vscode.CompletionItemKind.Keyword);
        qInvokable.documentation = 'Marks a method as invokable from QML.';
        items.push(qInvokable);

        const qEnum = new vscode.CompletionItem('Q_ENUM', vscode.CompletionItemKind.Keyword);
        qEnum.insertText = new vscode.SnippetString('Q_ENUM(${1:EnumName})');
        qEnum.documentation = 'Registers an enum with the meta-object system.';
        items.push(qEnum);

        return items;
    }
}
