import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface PchHeaderGroup {
    module: string;
    headers: string[];
}

const PCH_HEADER_CATALOG: PchHeaderGroup[] = [
    {
        module: 'Core',
        headers: [
            'QObject',
            'QString',
            'QList',
            'QVector',
            'QMap',
            'QHash',
            'QSet',
            'QVariant',
            'QDebug',
            'QTimer',
            'QDateTime',
            'QUrl',
            'QByteArray',
            'QMetaObject',
            'QMetaMethod'
        ]
    },
    {
        module: 'GUI',
        headers: [
            'QApplication',
            'QWidget',
            'QPainter',
            'QColor',
            'QFont',
            'QPalette',
            'QIcon',
            'QPixmap',
            'QImage',
            'QCursor',
            'QEvent',
            'QMouseEvent',
            'QKeyEvent',
            'QPaintEvent',
            'QResizeEvent'
        ]
    },
    {
        module: 'Widgets',
        headers: [
            'QMainWindow',
            'QPushButton',
            'QLabel',
            'QLineEdit',
            'QTextEdit',
            'QComboBox',
            'QListWidget',
            'QTreeWidget',
            'QTableWidget',
            'QVBoxLayout',
            'QHBoxLayout',
            'QGridLayout',
            'QFormLayout',
            'QMenuBar',
            'QToolBar',
            'QStatusBar',
            'QDialog',
            'QMessageBox',
            'QFileDialog',
            'QAction'
        ]
    },
    {
        module: 'Network',
        headers: [
            'QTcpSocket',
            'QTcpServer',
            'QUdpSocket',
            'QNetworkAccessManager',
            'QNetworkRequest',
            'QNetworkReply',
            'QHostAddress',
            'QUrlQuery'
        ]
    },
    {
        module: 'Sql',
        headers: [
            'QSqlDatabase',
            'QSqlQuery',
            'QSqlTableModel',
            'QSqlRecord',
            'QSqlError'
        ]
    },
    {
        module: 'Concurrent',
        headers: [
            'QFuture',
            'QFutureWatcher',
            'QtConcurrent'
        ]
    }
];

export class QtPchSupport {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    async generatePch(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        // Detect Qt modules from project file
        const detectedModules = this.detectQtModules(workspaceFolder.uri.fsPath);

        // Build QuickPick items grouped by module
        const items: vscode.QuickPickItem[] = [];
        const preSelected = new Set<string>();

        for (const group of PCH_HEADER_CATALOG) {
            const isDetected = detectedModules.includes(group.module.toLowerCase());
            items.push({
                label: group.module,
                kind: vscode.QuickPickItemKind.Separator
            });
            for (const header of group.headers) {
                items.push({
                    label: header,
                    description: `<${header.toLowerCase()}.h>`,
                    picked: isDetected
                });
                if (isDetected) {
                    preSelected.add(header);
                }
            }
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select Qt headers for precompiled header',
            canPickMany: true,
            ignoreFocusOut: true
        });

        if (!selected || selected.length === 0) {
            return;
        }

        const headers = selected.map(s => s.label);
        const pchFileName = 'qt_pch.h';
        const pchPath = path.join(workspaceFolder.uri.fsPath, pchFileName);

        // Check for overwrite
        if (fs.existsSync(pchPath)) {
            const overwrite = await vscode.window.showWarningMessage(
                `${pchFileName} already exists. Overwrite?`,
                'Overwrite',
                'Cancel'
            );
            if (overwrite !== 'Overwrite') {
                return;
            }
        }

        // Generate content
        const content = this.buildPchContent(headers);
        fs.writeFileSync(pchPath, content, 'utf-8');

        this.outputChannel.appendLine(`[PCH] Generated ${pchPath} with ${headers.length} headers`);

        // Show result with build system instructions
        const projectType = this.detectProjectType(workspaceFolder.uri.fsPath);
        const instructions = this.getBuildInstructions(projectType, pchFileName);

        const result = await vscode.window.showInformationMessage(
            `Generated ${pchFileName} with ${headers.length} headers`,
            'Copy Build Instructions',
            'Open File',
            'OK'
        );

        if (result === 'Open File') {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(pchPath));
            await vscode.window.showTextDocument(doc);
        } else if (result === 'Copy Build Instructions') {
            await vscode.env.clipboard.writeText(instructions);
            void vscode.window.showInformationMessage('Build instructions copied to clipboard');
        }
    }

    private buildPchContent(headers: string[]): string {
        const lines: string[] = [];
        lines.push('#pragma once');
        lines.push('');
        lines.push('// Qt Precompiled Header');
        lines.push('// Generated by Qt C++ Tools for VS Code');
        lines.push('');

        for (const header of headers) {
            lines.push(`#include <${header.toLowerCase()}>`);
        }

        lines.push('');
        return lines.join('\n');
    }

    private detectQtModules(workspacePath: string): string[] {
        const modules: string[] = [];

        // Try to find .pro file
        try {
            const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.pro')) {
                    const proContent = fs.readFileSync(path.join(workspacePath, entry.name), 'utf-8');
                    const match = proContent.match(/QT\s*\+?=\s*(.+)/m);
                    if (match) {
                        const qtLine = match[1];
                        if (qtLine.includes('core')) { modules.push('core'); }
                        if (qtLine.includes('gui')) { modules.push('gui'); }
                        if (qtLine.includes('widgets')) { modules.push('widgets'); }
                        if (qtLine.includes('network')) { modules.push('network'); }
                        if (qtLine.includes('sql')) { modules.push('sql'); }
                        if (qtLine.includes('concurrent')) { modules.push('concurrent'); }
                    }
                    break;
                }
            }
        } catch {
            // ignore
        }

        // Try to find CMakeLists.txt
        if (modules.length === 0) {
            try {
                const cmakePath = path.join(workspacePath, 'CMakeLists.txt');
                if (fs.existsSync(cmakePath)) {
                    const cmakeContent = fs.readFileSync(cmakePath, 'utf-8');
                    const compMatch = cmakeContent.match(/find_package\s*\(\s*Qt\d+\s+COMPONENTS\s+([^)]+)\)/i);
                    if (compMatch) {
                        const comps = compMatch[1].split(/\s+/).filter(s => s.length > 0);
                        for (const c of comps) {
                            const lc = c.toLowerCase();
                            if (['core', 'gui', 'widgets', 'network', 'sql', 'concurrent'].includes(lc)) {
                                modules.push(lc);
                            }
                        }
                    }
                }
            } catch {
                // ignore
            }
        }

        // Default to core + gui + widgets if nothing found
        if (modules.length === 0) {
            modules.push('core', 'gui', 'widgets');
        }

        return modules;
    }

    private detectProjectType(workspacePath: string): 'qmake' | 'cmake' | 'unknown' {
        try {
            const entries = fs.readdirSync(workspacePath);
            if (entries.some(e => e.endsWith('.pro'))) { return 'qmake'; }
            if (entries.includes('CMakeLists.txt')) { return 'cmake'; }
        } catch {
            // ignore
        }
        return 'unknown';
    }

    private getBuildInstructions(projectType: 'qmake' | 'cmake' | 'unknown', pchFileName: string): string {
        const lines: string[] = [];
        lines.push(`// Add the following to your build system to use ${pchFileName}:`);
        lines.push('');

        if (projectType === 'qmake') {
            lines.push('// In your .pro file:');
            lines.push(`PRECOMPILED_HEADER = ${pchFileName}`);
            lines.push('');
            lines.push('// For MSVC:');
            lines.push('CONFIG += precompile_header');
        } else if (projectType === 'cmake') {
            lines.push('// In your CMakeLists.txt (requires CMake 3.16+):');
            lines.push(`target_precompile_headers(YourTargetName PRIVATE "\${CMAKE_SOURCE_DIR}/${pchFileName}")`);
        } else {
            lines.push('// QMake:');
            lines.push(`PRECOMPILED_HEADER = ${pchFileName}`);
            lines.push('');
            lines.push('// CMake (3.16+):');
            lines.push(`target_precompile_headers(YourTargetName PRIVATE "\${CMAKE_SOURCE_DIR}/${pchFileName}")`);
            lines.push('');
            lines.push('// MSVC (cl.exe):');
            lines.push('/Yuqt_pch.h /FIqt_pch.h');
            lines.push('');
            lines.push('// GCC/Clang:');
            lines.push('# Create .gch manually or use ccache');
        }

        lines.push('');
        return lines.join('\n');
    }
}
