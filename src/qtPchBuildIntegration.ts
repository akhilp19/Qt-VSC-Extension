import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class QtPchBuildIntegration {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    // ========================================================================
    // Main Entry Point
    // ========================================================================

    async integratePch(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        // Check if qt_pch.h exists
        const pchPath = path.join(workspaceFolder.uri.fsPath, 'qt_pch.h');
        if (!fs.existsSync(pchPath)) {
            const result = await vscode.window.showInformationMessage(
                'qt_pch.h not found. Generate it first?',
                'Generate PCH',
                'Cancel'
            );
            if (result === 'Generate PCH') {
                await vscode.commands.executeCommand('qt.generatePch');
            }
            return;
        }

        // Find project files
        const proFiles: string[] = [];
        const cmakeFiles: string[] = [];

        try {
            const entries = fs.readdirSync(workspaceFolder.uri.fsPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile()) {
                    if (entry.name.endsWith('.pro')) {
                        proFiles.push(path.join(workspaceFolder.uri.fsPath, entry.name));
                    }
                    if (entry.name === 'CMakeLists.txt') {
                        cmakeFiles.push(path.join(workspaceFolder.uri.fsPath, entry.name));
                    }
                }
            }
        } catch {
            // ignore
        }

        // Also scan one level deep for .pro files
        try {
            const entries = fs.readdirSync(workspaceFolder.uri.fsPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !['build', 'out', '.git', 'node_modules'].includes(entry.name)) {
                    const subEntries = fs.readdirSync(path.join(workspaceFolder.uri.fsPath, entry.name));
                    for (const sub of subEntries) {
                        if (sub.endsWith('.pro')) {
                            proFiles.push(path.join(workspaceFolder.uri.fsPath, entry.name, sub));
                        }
                        if (sub === 'CMakeLists.txt') {
                            cmakeFiles.push(path.join(workspaceFolder.uri.fsPath, entry.name, sub));
                        }
                    }
                }
            }
        } catch {
            // ignore
        }

        const allProjects = [
            ...proFiles.map(f => ({ label: path.basename(f), description: f, type: 'qmake' as const, path: f })),
            ...cmakeFiles.map(f => ({ label: path.basename(f), description: f, type: 'cmake' as const, path: f }))
        ];

        if (allProjects.length === 0) {
            void vscode.window.showWarningMessage('No .pro or CMakeLists.txt found in workspace');
            return;
        }

        let selected = allProjects[0];
        if (allProjects.length > 1) {
            const pick = await vscode.window.showQuickPick(
                allProjects.map(p => ({ label: p.label, description: p.description, value: p })),
                { placeHolder: 'Select project to integrate PCH into' }
            );
            if (!pick) { return; }
            selected = pick.value;
        }

        if (selected.type === 'qmake') {
            await this.integratePchQmake(selected.path);
        } else {
            await this.integratePchCMake(selected.path);
        }
    }

    // ========================================================================
    // QMake Integration
    // ========================================================================

    async integratePchQmake(proFile: string): Promise<void> {
        const content = fs.readFileSync(proFile, 'utf-8');

        if (/PRECOMPILED_HEADER\s*=/.test(content)) {
            void vscode.window.showWarningMessage('PRECOMPILED_HEADER already exists in this .pro file');
            return;
        }

        const additions = '\n# Precompiled header (added by Qt C++ Tools)\nPRECOMPILED_HEADER = qt_pch.h\nCONFIG += precompile_header\n';
        const newContent = content + additions;

        const confirmed = await this.previewChanges(proFile, content, newContent);
        if (!confirmed) { return; }

        fs.writeFileSync(proFile, newContent, 'utf-8');
        this.outputChannel.appendLine(`[PCH] Integrated PCH into ${proFile}`);
        void vscode.window.showInformationMessage(`PCH integrated into ${path.basename(proFile)}`);
    }

    // ========================================================================
    // CMake Integration
    // ========================================================================

    async integratePchCMake(cmakeFile: string): Promise<void> {
        const content = fs.readFileSync(cmakeFile, 'utf-8');

        if (/target_precompile_headers/.test(content)) {
            void vscode.window.showWarningMessage('target_precompile_headers already exists in this CMakeLists.txt');
            return;
        }

        // Find target name
        const targetMatch = content.match(/add_(?:executable|library)\s*\(\s*(\w+)/);
        let targetName = targetMatch ? targetMatch[1] : undefined;

        if (!targetName) {
            const input = await vscode.window.showInputBox({
                prompt: 'Could not detect CMake target name. Please enter it:',
                placeHolder: 'MyApp',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Target name cannot be empty';
                    }
                    return null;
                }
            });
            if (!input) { return; }
            targetName = input.trim();
        }

        // Find the line after add_executable/add_library to insert after
        const lines = content.split('\n');
        let insertIndex = lines.length;
        for (let i = 0; i < lines.length; i++) {
            if (/^add_(executable|library)\s*\(/.test(lines[i])) {
                // Find closing paren
                let parenDepth = 0;
                for (let j = i; j < lines.length; j++) {
                    parenDepth += (lines[j].match(/\(/g) || []).length;
                    parenDepth -= (lines[j].match(/\)/g) || []).length;
                    if (parenDepth === 0) {
                        insertIndex = j + 1;
                        break;
                    }
                }
                break;
            }
        }

        const addition = `\n# Precompiled header (added by Qt C++ Tools)\ntarget_precompile_headers(${targetName} PRIVATE "\${CMAKE_SOURCE_DIR}/qt_pch.h")\n`;
        lines.splice(insertIndex, 0, addition);
        const newContent = lines.join('\n');

        const confirmed = await this.previewChanges(cmakeFile, content, newContent);
        if (!confirmed) { return; }

        fs.writeFileSync(cmakeFile, newContent, 'utf-8');
        this.outputChannel.appendLine(`[PCH] Integrated PCH into ${cmakeFile} (target: ${targetName})`);
        void vscode.window.showInformationMessage(`PCH integrated into ${path.basename(cmakeFile)} (target: ${targetName})`);
    }

    // ========================================================================
    // Preview / Confirm Changes
    // ========================================================================

    private async previewChanges(filePath: string, original: string, modified: string): Promise<boolean> {
        const fileName = path.basename(filePath);
        const diffUri = vscode.Uri.parse(`untitled:${fileName}.preview`);

        // Show a simple message with the additions highlighted
        const originalLines = original.split('\n');
        const modifiedLines = modified.split('\n');

        // Find added lines
        const addedLines: string[] = [];
        for (const line of modifiedLines) {
            if (!originalLines.includes(line)) {
                addedLines.push(line);
            }
        }

        const preview = addedLines.slice(0, 20).join('\n') + (addedLines.length > 20 ? '\n...' : '');

        const result = await vscode.window.showInformationMessage(
            `The following will be added to ${fileName}:\n\n${preview}`,
            { modal: true, detail: 'Preview changes before applying' },
            'Apply',
            'Cancel'
        );

        return result === 'Apply';
    }
}
