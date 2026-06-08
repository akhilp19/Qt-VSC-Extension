import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface BuildScript {
    path: string;
    type: 'makefile' | 'shell' | 'batch';
}

export class QtBuildScriptInjector {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    // ========================================================================
    // Detection
    // ========================================================================

    detectExistingBuildScripts(projectDir: string): BuildScript[] {
        const results: BuildScript[] = [];
        const candidates = [
            { name: 'Makefile', type: 'makefile' as const },
            { name: 'makefile', type: 'makefile' as const },
            { name: 'build.sh', type: 'shell' as const },
            { name: 'compile.sh', type: 'shell' as const },
            { name: 'build.bat', type: 'batch' as const },
            { name: 'compile.bat', type: 'batch' as const }
        ];

        for (const candidate of candidates) {
            const fullPath = path.join(projectDir, candidate.name);
            if (fs.existsSync(fullPath)) {
                results.push({ path: fullPath, type: candidate.type });
            }
        }

        // Also scan for any .sh or .bat containing compiler invocations
        try {
            const entries = fs.readdirSync(projectDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (ext === '.sh' || ext === '.bat') {
                        const fullPath = path.join(projectDir, entry.name);
                        // Skip if already added
                        if (results.some(r => r.path === fullPath)) { continue; }
                        try {
                            const content = fs.readFileSync(fullPath, 'utf-8');
                            if (/\b(g\+\+|clang\+\+|cl\.exe|gcc|clang)\b/.test(content)) {
                                results.push({ path: fullPath, type: ext === '.sh' ? 'shell' : 'batch' });
                            }
                        } catch {
                            // ignore
                        }
                    }
                }
            }
        } catch {
            // ignore
        }

        return results;
    }

    // ========================================================================
    // Main Command
    // ========================================================================

    async injectBuildScripts(projectDir?: string): Promise<void> {
        const targetDir = projectDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!targetDir) {
            void vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        const scripts = this.detectExistingBuildScripts(targetDir);
        if (scripts.length === 0) {
            const result = await vscode.window.showInformationMessage(
                'No build scripts found. Generate a new Makefile?',
                'Generate Makefile',
                'Cancel'
            );
            if (result === 'Generate Makefile') {
                await vscode.commands.executeCommand('qt.generateCustomMakefile', vscode.Uri.file(targetDir));
            }
            return;
        }

        let selected = scripts[0];
        if (scripts.length > 1) {
            const pick = await vscode.window.showQuickPick(
                scripts.map(s => ({ label: path.basename(s.path), description: s.path, value: s })),
                { placeHolder: 'Select build script to inject into' }
            );
            if (!pick) { return; }
            selected = pick.value;
        }

        // Scan for Qt files in the project
        const headers: string[] = [];
        const uiFiles: string[] = [];
        const qrcFiles: string[] = [];

        try {
            const entries = fs.readdirSync(targetDir);
            for (const entry of entries) {
                const ext = path.extname(entry).toLowerCase();
                if (ext === '.h' || ext === '.hpp') {
                    headers.push(entry);
                } else if (ext === '.ui') {
                    uiFiles.push(entry);
                } else if (ext === '.qrc') {
                    qrcFiles.push(entry);
                }
            }
        } catch {
            // ignore
        }

        let success = false;
        if (selected.type === 'makefile') {
            success = await this.injectIntoMakefile(selected.path, headers, uiFiles, qrcFiles);
        } else {
            success = await this.injectIntoShellScript(selected.path, headers, uiFiles, qrcFiles);
        }

        if (success) {
            void vscode.window.showInformationMessage(
                `MOC/UIC/RCC rules injected into ${path.basename(selected.path)}`,
                'Open File'
            ).then(choice => {
                if (choice === 'Open File') {
                    void vscode.workspace.openTextDocument(vscode.Uri.file(selected.path)).then(doc => {
                        void vscode.window.showTextDocument(doc);
                    });
                }
            });
        }
    }

    // ========================================================================
    // Makefile Injection
    // ========================================================================

    async injectIntoMakefile(
        makefilePath: string,
        headers: string[],
        uiFiles: string[],
        qrcFiles: string[]
    ): Promise<boolean> {
        let content = fs.readFileSync(makefilePath, 'utf-8');

        if (/\bmoc\b/.test(content) && /\buic\b/.test(content)) {
            void vscode.window.showWarningMessage('Makefile already appears to have MOC/UIC rules');
            return false;
        }

        const lines = content.split('\n');
        const additions: string[] = [];

        additions.push('');
        additions.push('# --- Qt Code Generation (injected by Qt C++ Tools) ---');

        if (headers.length > 0) {
            additions.push('MOC_SRC = $(patsubst %.h,moc_%.cpp,$(filter %.h,$(HEADERS))) $(patsubst %.hpp,moc_%.cpp,$(filter %.hpp,$(HEADERS)))');
        }
        if (uiFiles.length > 0) {
            additions.push('UI_HDR = $(patsubst %.ui,ui_%.h,$(UI_FILES))');
        }
        if (qrcFiles.length > 0) {
            additions.push('QRC_SRC = $(patsubst %.qrc,qrc_%.cpp,$(QRC_FILES))');
        }

        if (headers.length > 0) {
            additions.push('moc_%.cpp: %.h');
            additions.push('\t$(MOC) $< -o $@');
            additions.push('moc_%.cpp: %.hpp');
            additions.push('\t$(MOC) $< -o $@');
        }
        if (uiFiles.length > 0) {
            additions.push('ui_%.h: %.ui');
            additions.push('\t$(UIC) $< -o $@');
        }
        if (qrcFiles.length > 0) {
            additions.push('qrc_%.cpp: %.qrc');
            additions.push('\t$(RCC) $< -o $@');
        }

        additions.push('# --- End Qt Code Generation ---');

        const newContent = lines.join('\n') + '\n' + additions.join('\n') + '\n';

        const confirmed = await this.previewAndConfirm(makefilePath, content, newContent);
        if (!confirmed) { return false; }

        this.createBackup(makefilePath);
        fs.writeFileSync(makefilePath, newContent, 'utf-8');
        this.outputChannel.appendLine(`[BuildScript] Injected MOC/UIC/RCC into ${makefilePath}`);
        return true;
    }

    // ========================================================================
    // Shell / Batch Script Injection
    // ========================================================================

    async injectIntoShellScript(
        scriptPath: string,
        headers: string[],
        uiFiles: string[],
        qrcFiles: string[]
    ): Promise<boolean> {
        let content = fs.readFileSync(scriptPath, 'utf-8');

        if (/\bmoc\b/.test(content) && /\buic\b/.test(content)) {
            void vscode.window.showWarningMessage('Script already appears to have MOC/UIC commands');
            return false;
        }

        const lines = content.split('\n');
        const isBatch = path.extname(scriptPath).toLowerCase() === '.bat';

        // Find first compiler invocation
        let insertIndex = lines.length;
        for (let i = 0; i < lines.length; i++) {
            if (/\b(g\+\+|clang\+\+|cl\.exe|gcc|clang)\b/.test(lines[i])) {
                insertIndex = i;
                break;
            }
        }

        const injections: string[] = [];
        injections.push('');
        injections.push(isBatch ? 'REM Qt Code Generation (injected by Qt C++ Tools)' : '# Qt Code Generation (injected by Qt C++ Tools)');

        for (const header of headers) {
            const base = path.basename(header, path.extname(header));
            const ext = path.extname(header);
            injections.push(isBatch
                ? `moc "${header}" -o "moc_${base}.cpp"`
                : `moc "${header}" -o "moc_${base}.cpp"`
            );
        }
        for (const ui of uiFiles) {
            const base = path.basename(ui, '.ui');
            injections.push(isBatch
                ? `uic "${ui}" -o "ui_${base}.h"`
                : `uic "${ui}" -o "ui_${base}.h"`
            );
        }
        for (const qrc of qrcFiles) {
            const base = path.basename(qrc, '.qrc');
            injections.push(isBatch
                ? `rcc "${qrc}" -o "qrc_${base}.cpp"`
                : `rcc "${qrc}" -o "qrc_${base}.cpp"`
            );
        }

        injections.push(isBatch ? 'REM End Qt Code Generation' : '# End Qt Code Generation');

        lines.splice(insertIndex, 0, ...injections);
        const newContent = lines.join('\n');

        const confirmed = await this.previewAndConfirm(scriptPath, content, newContent);
        if (!confirmed) { return false; }

        this.createBackup(scriptPath);
        fs.writeFileSync(scriptPath, newContent, 'utf-8');
        this.outputChannel.appendLine(`[BuildScript] Injected MOC/UIC/RCC into ${scriptPath}`);
        return true;
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private async previewAndConfirm(filePath: string, original: string, modified: string): Promise<boolean> {
        const addedLines: string[] = [];
        const origSet = new Set(original.split('\n'));
        for (const line of modified.split('\n')) {
            if (!origSet.has(line) && line.trim().length > 0) {
                addedLines.push(line);
            }
        }

        const preview = addedLines.slice(0, 15).join('\n') + (addedLines.length > 15 ? '\n...' : '');
        const result = await vscode.window.showInformationMessage(
            `Changes to ${path.basename(filePath)}:\n\n${preview}`,
            { modal: true, detail: 'Preview before applying' },
            'Apply',
            'Cancel'
        );
        return result === 'Apply';
    }

    private createBackup(filePath: string): void {
        const dir = path.dirname(filePath);
        const base = path.basename(filePath);
        let backupPath = path.join(dir, `${base}.bak`);
        let counter = 1;
        while (fs.existsSync(backupPath)) {
            backupPath = path.join(dir, `${base}.bak.${counter}`);
            counter++;
        }
        fs.copyFileSync(filePath, backupPath);
        this.outputChannel.appendLine(`[BuildScript] Backup created: ${backupPath}`);
    }
}
