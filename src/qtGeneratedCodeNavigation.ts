import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { resolveGeneratedOutputPath } from './qtCodeGenerator';

/**
 * Maps source file types to their generated counterparts.
 */
function getGeneratedInfo(filePath: string): { tool: 'moc' | 'uic' | 'rcc'; prefix: string; ext?: string } | undefined {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.h' || ext === '.hpp') {
        return { tool: 'moc', prefix: 'moc_' };
    }
    if (ext === '.ui') {
        return { tool: 'uic', prefix: 'ui_', ext: '.h' };
    }
    if (ext === '.qrc') {
        return { tool: 'rcc', prefix: 'qrc_' };
    }
    return undefined;
}

function resolveGeneratedPath(filePath: string): string | undefined {
    const info = getGeneratedInfo(filePath);
    if (!info) {
        return undefined;
    }
    return resolveGeneratedOutputPath(filePath, info.prefix, info.ext);
}

// ========================================================================
// Definition Provider — offers generated file as secondary location
// ========================================================================

class GeneratedCodeDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        const filePath = document.fileName;
        const ext = path.extname(filePath).toLowerCase();

        // Only for headers
        if (ext !== '.h' && ext !== '.hpp') {
            return undefined;
        }

        // Check if header contains Q_OBJECT
        if (!hasQObject(filePath)) {
            return undefined;
        }

        const generatedPath = resolveGeneratedPath(filePath);
        if (!generatedPath || !fs.existsSync(generatedPath)) {
            return undefined;
        }

        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) {
            return undefined;
        }

        // Offer the generated moc file as a LocationLink
        const link: vscode.LocationLink = {
            targetUri: vscode.Uri.file(generatedPath),
            targetRange: new vscode.Range(0, 0, 0, 0),
            targetSelectionRange: new vscode.Range(0, 0, 0, 0),
            originSelectionRange: wordRange
        };

        return [link];
    }
}

function hasQObject(filePath: string): boolean {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
            const commentIdx = line.indexOf('//');
            const qobjIdx = line.indexOf('Q_OBJECT');
            if (qobjIdx !== -1 && (commentIdx === -1 || qobjIdx < commentIdx)) {
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}

// ========================================================================
// Main Navigation Class
// ========================================================================

export class QtGeneratedCodeNavigation implements vscode.Disposable {
    private outputChannel: vscode.OutputChannel;
    private disposables: vscode.Disposable[] = [];
    public definitionProvider: GeneratedCodeDefinitionProvider;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.definitionProvider = new GeneratedCodeDefinitionProvider();
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }

    // ========================================================================
    // Commands
    // ========================================================================

    async goToGeneratedCode(filePath?: string): Promise<void> {
        const targetPath = filePath ?? vscode.window.activeTextEditor?.document.fileName;
        if (!targetPath) {
            void vscode.window.showWarningMessage('No file selected');
            return;
        }

        const generatedPath = resolveGeneratedPath(targetPath);
        if (!generatedPath) {
            void vscode.window.showWarningMessage('No generated code mapping for this file type');
            return;
        }

        if (!fs.existsSync(generatedPath)) {
            const info = getGeneratedInfo(targetPath);
            const action = info ? `Generate ${info.tool.toUpperCase()}` : 'Generate';
            const result = await vscode.window.showInformationMessage(
                `Generated file not found: ${path.basename(generatedPath)}`,
                action,
                'Cancel'
            );
            if (result === action) {
                const cmd = `qt.generate${info!.tool.charAt(0).toUpperCase() + info!.tool.slice(1)}`;
                await vscode.commands.executeCommand(cmd, vscode.Uri.file(targetPath));
            }
            return;
        }

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(generatedPath));
        await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside
        });

        this.outputChannel.appendLine(`[Nav] Opened generated code: ${generatedPath}`);
    }

    async peekGeneratedCode(filePath?: string): Promise<void> {
        const targetPath = filePath ?? vscode.window.activeTextEditor?.document.fileName;
        const editor = vscode.window.activeTextEditor;
        if (!targetPath || !editor) {
            void vscode.window.showWarningMessage('No file open in editor');
            return;
        }

        const generatedPath = resolveGeneratedPath(targetPath);
        if (!generatedPath) {
            void vscode.window.showWarningMessage('No generated code mapping for this file type');
            return;
        }

        if (!fs.existsSync(generatedPath)) {
            const info = getGeneratedInfo(targetPath);
            const action = info ? `Generate ${info.tool.toUpperCase()}` : 'Generate';
            const result = await vscode.window.showInformationMessage(
                `Generated file not found: ${path.basename(generatedPath)}`,
                action,
                'Cancel'
            );
            if (result === action) {
                const cmd = `qt.generate${info!.tool.charAt(0).toUpperCase() + info!.tool.slice(1)}`;
                await vscode.commands.executeCommand(cmd, vscode.Uri.file(targetPath));
            }
            return;
        }

        const locations: vscode.Location[] = [
            new vscode.Location(vscode.Uri.file(generatedPath), new vscode.Position(0, 0))
        ];

        await vscode.commands.executeCommand(
            'editor.action.peekLocations',
            editor.document.uri,
            editor.selection.active,
            locations,
            'peek'
        );

        this.outputChannel.appendLine(`[Nav] Peek generated code: ${generatedPath}`);
    }
}
