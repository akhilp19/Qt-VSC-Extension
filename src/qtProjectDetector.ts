import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface QtProject {
    file: string;
    type: 'qmake' | 'cmake';
    name: string;
    directory: string;
}

export class QtProjectDetector {
    private outputChannel: vscode.OutputChannel;
    private fileWatcher?: vscode.FileSystemWatcher;
    
    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.setupFileWatcher();
    }
    
    /**
     * Set up file watcher for project files
     */
    private setupFileWatcher(): void {
        // Watch for .pro and CMakeLists.txt files
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{pro,txt}',
            false, // ignoreCreateEvents
            false, // ignoreChangeEvents
            false  // ignoreDeleteEvents
        );
        
        this.fileWatcher.onDidCreate(() => {
            this.outputChannel.appendLine('Qt project file created, refreshing tasks...');
        });
        
        this.fileWatcher.onDidChange(() => {
            this.outputChannel.appendLine('Qt project file changed, refreshing tasks...');
        });
        
        this.fileWatcher.onDidDelete(() => {
            this.outputChannel.appendLine('Qt project file deleted, refreshing tasks...');
        });
    }
    
    /**
     * Detect all Qt projects in the workspace
     */
    async detectProjects(workspacePath: string): Promise<string[]> {
        const projects: string[] = [];
        
        // Find .pro files
        const proFiles = await this.findFiles(workspacePath, '**/*.pro');
        projects.push(...proFiles);
        
        // Find CMakeLists.txt files that use Qt
        const cmakeFiles = await this.findFiles(workspacePath, '**/CMakeLists.txt');
        for (const cmakeFile of cmakeFiles) {
            if (await this.isQtCMakeProject(cmakeFile)) {
                projects.push(cmakeFile);
            }
        }
        
        this.outputChannel.appendLine(`Found ${projects.length} Qt project(s)`);
        for (const project of projects) {
            this.outputChannel.appendLine(`  - ${project}`);
        }
        
        return projects;
    }
    
    /**
     * Get detailed project information
     */
    async getProjectInfo(projectFile: string): Promise<QtProject | undefined> {
        if (!fs.existsSync(projectFile)) {
            return undefined;
        }
        
        const ext = path.extname(projectFile).toLowerCase();
        const directory = path.dirname(projectFile);
        const name = path.basename(projectFile, ext);
        
        if (ext === '.pro') {
            return {
                file: projectFile,
                type: 'qmake',
                name: name,
                directory: directory
            };
        } else if (path.basename(projectFile) === 'CMakeLists.txt') {
            const isQt = await this.isQtCMakeProject(projectFile);
            if (isQt) {
                return {
                    file: projectFile,
                    type: 'cmake',
                    name: path.basename(directory),
                    directory: directory
                };
            }
        }
        
        return undefined;
    }
    
    /**
     * Find files matching a pattern
     */
    private async findFiles(workspacePath: string, pattern: string): Promise<string[]> {
        const files: string[] = [];
        
        try {
            const config = vscode.workspace.getConfiguration('qt');
            const autoDetect = config.get<string>('autoDetect');
            
            if (autoDetect === 'off') {
                return files;
            }
            
            const uris = await vscode.workspace.findFiles(
                new vscode.RelativePattern(workspacePath, pattern),
                '**/node_modules/**'
            );
            
            for (const uri of uris) {
                files.push(uri.fsPath);
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error finding files: ${error}`);
        }
        
        return files;
    }
    
    /**
     * Check if a CMakeLists.txt file is for a Qt project
     */
    private async isQtCMakeProject(cmakeFile: string): Promise<boolean> {
        try {
            const content = fs.readFileSync(cmakeFile, 'utf-8');
            
            // Look for Qt-related CMake commands
            const qtPatterns = [
                /find_package\s*\(\s*Qt[56]/i,
                /qt5_wrap_cpp/i,
                /qt5_wrap_ui/i,
                /qt5_add_resources/i,
                /qt6_wrap_cpp/i,
                /qt6_wrap_ui/i,
                /qt6_add_resources/i,
                /set\s*\(\s*CMAKE_AUTOMOC\s+ON/i,
                /set\s*\(\s*CMAKE_AUTOUIC\s+ON/i,
                /set\s*\(\s*CMAKE_AUTORCC\s+ON/i
            ];
            
            for (const pattern of qtPatterns) {
                if (pattern.test(content)) {
                    return true;
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error reading CMakeLists.txt: ${error}`);
        }
        
        return false;
    }
    
    /**
     * Parse QMake project file for target information
     */
    async parseQMakeProject(proFile: string): Promise<{ target?: string; template?: string }> {
        const result: { target?: string; template?: string } = {};
        
        try {
            const content = fs.readFileSync(proFile, 'utf-8');
            const lines = content.split('\n');
            
            for (const line of lines) {
                const trimmed = line.trim();
                
                // Parse TARGET
                const targetMatch = trimmed.match(/^TARGET\s*[+]?=\s*(.+)$/i);
                if (targetMatch) {
                    result.target = targetMatch[1].trim();
                }
                
                // Parse TEMPLATE
                const templateMatch = trimmed.match(/^TEMPLATE\s*[+]?=\s*(.+)$/i);
                if (templateMatch) {
                    result.template = templateMatch[1].trim();
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing .pro file: ${error}`);
        }
        
        return result;
    }
    
    /**
     * Parse CMake project file for target information
     */
    async parseCMakeProject(cmakeFile: string): Promise<{ targets: string[] }> {
        const result: { targets: string[] } = { targets: [] };
        
        try {
            const content = fs.readFileSync(cmakeFile, 'utf-8');
            
            // Find add_executable and add_library commands
            const executableMatches = content.matchAll(/add_executable\s*\(\s*([a-zA-Z0-9_]+)/gi);
            const libraryMatches = content.matchAll(/add_library\s*\(\s*([a-zA-Z0-9_]+)/gi);
            
            for (const match of executableMatches) {
                if (match[1]) {
                    result.targets.push(match[1]);
                }
            }
            
            for (const match of libraryMatches) {
                if (match[1]) {
                    result.targets.push(match[1]);
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing CMakeLists.txt: ${error}`);
        }
        
        return result;
    }
    
    /**
     * Find the executable to run for a project
     */
    async findExecutable(projectFile: string, buildDir: string): Promise<string | undefined> {
        const projectInfo = await this.getProjectInfo(projectFile);
        if (!projectInfo) {
            return undefined;
        }
        
        let exeName: string | undefined;
        
        if (projectInfo.type === 'qmake') {
            const proInfo = await this.parseQMakeProject(projectFile);
            exeName = proInfo.target || projectInfo.name;
        } else if (projectInfo.type === 'cmake') {
            const cmakeInfo = await this.parseCMakeProject(projectFile);
            if (cmakeInfo.targets.length > 0) {
                exeName = cmakeInfo.targets[0];
            }
        }
        
        if (!exeName) {
            return undefined;
        }
        
        // Look for executable in build directory
        const possiblePaths = [
            path.join(buildDir, `${exeName}.exe`),
            path.join(buildDir, 'debug', `${exeName}.exe`),
            path.join(buildDir, 'release', `${exeName}.exe`),
            path.join(buildDir, 'Debug', `${exeName}.exe`),
            path.join(buildDir, 'Release', `${exeName}.exe`)
        ];
        
        for (const exePath of possiblePaths) {
            if (fs.existsSync(exePath)) {
                return exePath;
            }
        }
        
        return undefined;
    }
    
    /**
     * Dispose resources
     */
    dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}
