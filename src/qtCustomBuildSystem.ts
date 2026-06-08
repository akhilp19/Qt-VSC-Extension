import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { QtProject } from './qtProjectDetector';

const EXCLUDED_DIRS = ['build', 'out', '.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', '.vscode'];

export class QtCustomBuildSystem {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    // ========================================================================
    // Raw Project Detection
    // ========================================================================

    detectRawQtProjects(workspacePath: string): string[] {
        const results: string[] = [];
        const scanned = new Set<string>();

        // First, find all directories that have .pro or CMakeLists.txt
        const managedDirs = new Set<string>();
        try {
            const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !EXCLUDED_DIRS.includes(entry.name)) {
                    const subPath = path.join(workspacePath, entry.name);
                    const hasPro = fs.readdirSync(subPath).some(f => f.endsWith('.pro'));
                    const hasCMake = fs.readdirSync(subPath).includes('CMakeLists.txt');
                    if (hasPro || hasCMake) {
                        managedDirs.add(subPath);
                    }
                }
            }
        } catch {
            // ignore
        }

        // Also check root for .pro / CMakeLists.txt
        try {
            const rootFiles = fs.readdirSync(workspacePath);
            if (rootFiles.some(f => f.endsWith('.pro')) || rootFiles.includes('CMakeLists.txt')) {
                managedDirs.add(workspacePath);
            }
        } catch {
            // ignore
        }

        // Now scan for raw projects
        this.scanForRawProjects(workspacePath, results, scanned, managedDirs);

        this.outputChannel.appendLine(`[CustomBuild] Found ${results.length} raw Qt project(s)`);
        for (const r of results) {
            this.outputChannel.appendLine(`  - ${r}`);
        }

        return results;
    }

    private scanForRawProjects(
        dirPath: string,
        results: string[],
        scanned: Set<string>,
        managedDirs: Set<string>
    ): void {
        if (scanned.has(dirPath)) { return; }
        scanned.add(dirPath);

        // Skip if this directory is inside a managed project
        for (const managed of managedDirs) {
            if (dirPath.startsWith(managed + path.sep)) {
                return;
            }
        }

        // Skip if this directory IS a managed project
        if (managedDirs.has(dirPath)) {
            // Still scan subdirectories in case there are nested raw projects
        }

        let hasQtInclude = false;
        let hasCppFile = false;

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const subDirs: string[] = [];

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    if (!EXCLUDED_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
                        subDirs.push(fullPath);
                    }
                    continue;
                }

                if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (ext === '.cpp' || ext === '.h' || ext === '.hpp') {
                        hasCppFile = true;
                        if (!hasQtInclude) {
                            try {
                                const content = fs.readFileSync(fullPath, 'utf-8');
                                if (/#[\s]*include[\s]*[<"][\s]*Q/.test(content)) {
                                    hasQtInclude = true;
                                }
                            } catch {
                                // ignore
                            }
                        }
                    }
                }
            }

            // If this directory has Qt includes and is not managed, it's a raw project
            if (hasQtInclude && hasCppFile && !managedDirs.has(dirPath)) {
                results.push(dirPath);
            }

            // Scan subdirectories regardless (they might be raw projects)
            for (const subDir of subDirs) {
                this.scanForRawProjects(subDir, results, scanned, managedDirs);
            }
        } catch {
            // ignore permission errors
        }
    }

    // ========================================================================
    // Makefile Generation
    // ========================================================================

    async generateMakefile(projectDir?: string): Promise<void> {
        const targetDir = projectDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!targetDir) {
            void vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        // Scan for files
        const sources: string[] = [];
        const headers: string[] = [];
        const uiFiles: string[] = [];
        const qrcFiles: string[] = [];
        const modules = new Set<string>();

        try {
            const entries = fs.readdirSync(targetDir);
            for (const entry of entries) {
                const ext = path.extname(entry).toLowerCase();
                const fullPath = path.join(targetDir, entry);
                if (ext === '.cpp') {
                    sources.push(entry);
                    this.detectModulesFromFile(fullPath, modules);
                } else if (ext === '.h' || ext === '.hpp') {
                    headers.push(entry);
                    this.detectModulesFromFile(fullPath, modules);
                } else if (ext === '.ui') {
                    uiFiles.push(entry);
                } else if (ext === '.qrc') {
                    qrcFiles.push(entry);
                }
            }
        } catch {
            // ignore
        }

        if (sources.length === 0) {
            void vscode.window.showWarningMessage('No .cpp files found in this directory');
            return;
        }

        // Confirm file selection
        const allFiles = [...sources, ...headers, ...uiFiles, ...qrcFiles];
        const filePick = await vscode.window.showQuickPick(
            allFiles.map(f => ({ label: f, picked: true })),
            { placeHolder: 'Select files to include in Makefile', canPickMany: true }
        );
        if (!filePick || filePick.length === 0) {
            return;
        }

        const selectedSources = filePick.filter(f => f.label.endsWith('.cpp')).map(f => f.label);
        const selectedHeaders = filePick.filter(f => f.label.endsWith('.h') || f.label.endsWith('.hpp')).map(f => f.label);
        const selectedUi = filePick.filter(f => f.label.endsWith('.ui')).map(f => f.label);
        const selectedQrc = filePick.filter(f => f.label.endsWith('.qrc')).map(f => f.label);

        // Default modules if none detected
        if (modules.size === 0) {
            modules.add('core');
            modules.add('gui');
            modules.add('widgets');
        }

        // Generate Makefile
        const projectName = path.basename(targetDir);
        const makefilePath = path.join(targetDir, 'Makefile');

        if (fs.existsSync(makefilePath)) {
            const overwrite = await vscode.window.showWarningMessage(
                'Makefile already exists. Overwrite?',
                'Overwrite',
                'Cancel'
            );
            if (overwrite !== 'Overwrite') {
                return;
            }
        }

        const content = this.buildMakefile(projectName, selectedSources, selectedHeaders, selectedUi, selectedQrc, Array.from(modules));
        fs.writeFileSync(makefilePath, content, 'utf-8');

        this.outputChannel.appendLine(`[CustomBuild] Generated Makefile at ${makefilePath}`);

        const makeCmd = process.platform === 'win32' ? 'mingw32-make' : 'make';
        void vscode.window.showInformationMessage(
            `Generated Makefile for "${projectName}"`,
            'Build Now',
            'Open File'
        ).then(choice => {
            if (choice === 'Open File') {
                void vscode.workspace.openTextDocument(vscode.Uri.file(makefilePath)).then(doc => {
                    void vscode.window.showTextDocument(doc);
                });
            } else if (choice === 'Build Now') {
                const terminal = vscode.window.createTerminal('Qt Build');
                terminal.sendText(`${makeCmd} -C "${targetDir}"`);
                terminal.show();
            }
        });
    }

    private detectModulesFromFile(filePath: string, modules: Set<string>): void {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (/#[\s]*include[\s]*[<"][\s]*Q/.test(content)) {
                // Core is always needed
                modules.add('core');
            }
            if (/#[\s]*include[\s]*[<"][\s]*QWidget|QApplication|QPainter|QMainWindow/.test(content)) {
                modules.add('gui');
                modules.add('widgets');
            }
            if (/#[\s]*include[\s]*[<"][\s]*QTcpSocket|QNetworkAccessManager|QUdpSocket/.test(content)) {
                modules.add('network');
            }
            if (/#[\s]*include[\s]*[<"][\s]*QSql/.test(content)) {
                modules.add('sql');
            }
            if (/#[\s]*include[\s]*[<"][\s]*QtConcurrent/.test(content)) {
                modules.add('concurrent');
            }
        } catch {
            // ignore
        }
    }

    private buildMakefile(
        projectName: string,
        sources: string[],
        headers: string[],
        uiFiles: string[],
        qrcFiles: string[],
        modules: string[]
    ): string {
        const qtModules = modules.map(m => `Qt6${this.capitalize(m)}`).join(' ');
        const qtModules5 = modules.map(m => `Qt5${this.capitalize(m)}`).join(' ');
        const lines: string[] = [];

        lines.push(`# Makefile for ${projectName}`);
        lines.push(`# Generated by Qt C++ Tools for VS Code`);
        lines.push('');
        lines.push('# Detect Qt version (Qt6 preferred, fallback to Qt5)');
        lines.push('QT_MODULES := ' + qtModules);
        lines.push('QT_MODULES_5 := ' + qtModules5);
        lines.push('');
        lines.push('CXX := g++');
        lines.push('MOC := moc');
        lines.push('UIC := uic');
        lines.push('RCC := rcc');
        lines.push('');

        // pkg-config or qmake query for flags
        lines.push('# Try Qt6 first, fallback to Qt5');
        lines.push('QT_CXXFLAGS := $(shell pkg-config --cflags $(QT_MODULES) 2>/dev/null || pkg-config --cflags $(QT_MODULES_5) 2>/dev/null)');
        lines.push('QT_LDFLAGS := $(shell pkg-config --libs $(QT_MODULES) 2>/dev/null || pkg-config --libs $(QT_MODULES_5) 2>/dev/null)');
        lines.push('');
        lines.push('CXXFLAGS := -std=c++17 $(QT_CXXFLAGS) -fPIC -Wall');
        lines.push('LDFLAGS := $(QT_LDFLAGS)');
        lines.push('');

        lines.push(`SOURCES := ${sources.join(' ')}`);
        if (headers.length > 0) {
            lines.push(`HEADERS := ${headers.join(' ')}`);
        }
        if (uiFiles.length > 0) {
            lines.push(`UI_FILES := ${uiFiles.join(' ')}`);
        }
        if (qrcFiles.length > 0) {
            lines.push(`QRC_FILES := ${qrcFiles.join(' ')}`);
        }
        lines.push('');

        // Generated files
        if (headers.length > 0) {
            lines.push('MOC_SRC := $(patsubst %.h,moc_%.cpp,$(filter %.h,$(HEADERS))) $(patsubst %.hpp,moc_%.cpp,$(filter %.hpp,$(HEADERS)))');
        }
        if (uiFiles.length > 0) {
            lines.push('UI_HDR := $(patsubst %.ui,ui_%.h,$(UI_FILES))');
        }
        if (qrcFiles.length > 0) {
            lines.push('QRC_SRC := $(patsubst %.qrc,qrc_%.cpp,$(QRC_FILES))');
        }
        lines.push('');

        lines.push(`TARGET := ${projectName}`);
        lines.push('');

        // Build rules
        const allDeps = ['$(TARGET)'];
        if (headers.length > 0) { allDeps.push('$(MOC_SRC)'); }
        if (uiFiles.length > 0) { allDeps.push('$(UI_HDR)'); }
        if (qrcFiles.length > 0) { allDeps.push('$(QRC_SRC)'); }
        lines.push(`all: ${allDeps.join(' ')}`);
        lines.push('');

        lines.push('$(TARGET): $(SOURCES)' +
            (headers.length > 0 ? ' $(MOC_SRC)' : '') +
            (qrcFiles.length > 0 ? ' $(QRC_SRC)' : '') +
            (uiFiles.length > 0 ? ' $(UI_HDR)' : ''));
        lines.push('\t$(CXX) $(CXXFLAGS) $(SOURCES)' +
            (headers.length > 0 ? ' $(MOC_SRC)' : '') +
            (qrcFiles.length > 0 ? ' $(QRC_SRC)' : '') +
            ' -o $@ $(LDFLAGS)');
        lines.push('');

        if (headers.length > 0) {
            lines.push('moc_%.cpp: %.h');
            lines.push('\t$(MOC) $< -o $@');
            lines.push('');
            lines.push('moc_%.cpp: %.hpp');
            lines.push('\t$(MOC) $< -o $@');
            lines.push('');
        }

        if (uiFiles.length > 0) {
            lines.push('ui_%.h: %.ui');
            lines.push('\t$(UIC) $< -o $@');
            lines.push('');
        }

        if (qrcFiles.length > 0) {
            lines.push('qrc_%.cpp: %.qrc');
            lines.push('\t$(RCC) $< -o $@');
            lines.push('');
        }

        // Clean
        const cleanItems = ['$(TARGET)'];
        if (headers.length > 0) { cleanItems.push('$(MOC_SRC)'); }
        if (uiFiles.length > 0) { cleanItems.push('$(UI_HDR)'); }
        if (qrcFiles.length > 0) { cleanItems.push('$(QRC_SRC)'); }
        lines.push(`clean:`);
        lines.push(`\trm -f ${cleanItems.join(' ')}`);
        lines.push('');

        lines.push('.PHONY: all clean');
        lines.push('');

        return lines.join('\n');
    }

    private capitalize(s: string): string {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // ========================================================================
    // Project Info for Task Provider
    // ========================================================================

    getProjectInfoForRawProject(projectDir: string): QtProject {
        return {
            file: projectDir,
            type: 'raw',
            name: path.basename(projectDir),
            directory: projectDir
        };
    }
}
