import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

export interface QtInstallation {
    path: string;
    qmakePath: string;
    version?: string;
    compiler?: string;
}

export class QtConfigManager {
    private outputChannel: vscode.OutputChannel;
    private cachedQtInstallation?: QtInstallation;
    
    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }
    
    /**
     * Get the configured or detected Qt installation
     */
    async getQtInstallation(): Promise<QtInstallation | undefined> {
        if (this.cachedQtInstallation) {
            return this.cachedQtInstallation;
        }
        
        return await this.detectQtInstallation();
    }
    
    /**
     * Detect Qt installation from configuration or system
     */
    async detectQtInstallation(): Promise<QtInstallation | undefined> {
        this.outputChannel.appendLine('Detecting Qt installation...');
        
        // 1. Check user configuration
        const config = vscode.workspace.getConfiguration('qt');
        const configuredQmakePath = config.get<string>('qmakePath');
        const configuredQtPath = config.get<string>('qtInstallPath');
        
        if (configuredQmakePath && fs.existsSync(configuredQmakePath)) {
            this.outputChannel.appendLine(`Using configured qmake: ${configuredQmakePath}`);
            const installation = await this.createInstallationFromQMake(configuredQmakePath);
            if (installation) {
                this.cachedQtInstallation = installation;
                return installation;
            }
        }
        
        if (configuredQtPath && fs.existsSync(configuredQtPath)) {
            const qmakePath = this.findQMakeInPath(configuredQtPath);
            if (qmakePath) {
                this.outputChannel.appendLine(`Found qmake in configured Qt path: ${qmakePath}`);
                const installation = await this.createInstallationFromQMake(qmakePath);
                if (installation) {
                    this.cachedQtInstallation = installation;
                    return installation;
                }
            }
        }
        
        // 2. Check QTDIR environment variable
        const qtDir = process.env.QTDIR;
        if (qtDir && fs.existsSync(qtDir)) {
            const qmakePath = this.findQMakeInPath(qtDir);
            if (qmakePath) {
                this.outputChannel.appendLine(`Found qmake via QTDIR: ${qmakePath}`);
                const installation = await this.createInstallationFromQMake(qmakePath);
                if (installation) {
                    this.cachedQtInstallation = installation;
                    return installation;
                }
            }
        }
        
        // 3. Check PATH environment variable
        try {
            const qmakeInPath = execSync('where qmake', { encoding: 'utf-8' }).trim().split('\n')[0];
            if (qmakeInPath && fs.existsSync(qmakeInPath)) {
                this.outputChannel.appendLine(`Found qmake in PATH: ${qmakeInPath}`);
                const installation = await this.createInstallationFromQMake(qmakeInPath);
                if (installation) {
                    this.cachedQtInstallation = installation;
                    return installation;
                }
            }
        } catch (error) {
            // qmake not in PATH, continue searching
        }
        
        // 4. Search common installation directories
        const installations = await this.findQtInstallations();
        if (installations.length > 0) {
            this.outputChannel.appendLine(`Found Qt installation: ${installations[0].path}`);
            this.cachedQtInstallation = installations[0];
            return installations[0];
        }
        
        this.outputChannel.appendLine('No Qt installation found. Please configure Qt path manually.');
        return undefined;
    }
    
    /**
     * Find all Qt installations in common directories
     */
    async findQtInstallations(): Promise<QtInstallation[]> {
        const installations: QtInstallation[] = [];
        const searchPaths = [
            'C:\\Qt',
            'C:\\Program Files\\Qt',
            'C:\\Program Files (x86)\\Qt',
            process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Qt') : ''
        ].filter(p => p && fs.existsSync(p));
        
        for (const searchPath of searchPaths) {
            try {
                const versionDirs = fs.readdirSync(searchPath, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => path.join(searchPath, dirent.name));
                
                for (const versionDir of versionDirs) {
                    try {
                        const compilerDirs = fs.readdirSync(versionDir, { withFileTypes: true })
                            .filter(dirent => dirent.isDirectory())
                            .map(dirent => path.join(versionDir, dirent.name));
                        
                        for (const compilerDir of compilerDirs) {
                            const qmakePath = this.findQMakeInPath(compilerDir);
                            if (qmakePath) {
                                const installation = await this.createInstallationFromQMake(qmakePath);
                                if (installation) {
                                    installations.push(installation);
                                }
                            }
                        }
                    } catch (error) {
                        // Skip directories we can't read
                    }
                }
            } catch (error) {
                // Skip directories we can't read
            }
        }
        
        return installations;
    }
    
    /**
     * Find qmake executable in a directory
     */
    private findQMakeInPath(dirPath: string): string | undefined {
        const binPath = path.join(dirPath, 'bin');
        const qmakePath = path.join(binPath, 'qmake.exe');
        
        if (fs.existsSync(qmakePath)) {
            return qmakePath;
        }
        
        // Try without bin subdirectory
        const directQmakePath = path.join(dirPath, 'qmake.exe');
        if (fs.existsSync(directQmakePath)) {
            return directQmakePath;
        }
        
        return undefined;
    }
    
    /**
     * Create Qt installation object from qmake path
     */
    private async createInstallationFromQMake(qmakePath: string): Promise<QtInstallation | undefined> {
        try {
            // Get Qt version and paths from qmake
            const versionOutput = execSync(`"${qmakePath}" -query QT_VERSION`, { encoding: 'utf-8' }).trim();
            const installPrefixOutput = execSync(`"${qmakePath}" -query QT_INSTALL_PREFIX`, { encoding: 'utf-8' }).trim();
            
            // Detect compiler type from path
            const compiler = this.detectCompiler(qmakePath);
            
            return {
                path: installPrefixOutput,
                qmakePath: qmakePath,
                version: versionOutput,
                compiler: compiler
            };
        } catch (error) {
            this.outputChannel.appendLine(`Failed to query qmake at ${qmakePath}: ${error}`);
            return undefined;
        }
    }
    
    /**
     * Detect compiler type from Qt installation path
     */
    private detectCompiler(qmakePath: string): string {
        const lowerPath = qmakePath.toLowerCase();
        
        if (lowerPath.includes('msvc2022')) {
            return 'msvc2022';
        } else if (lowerPath.includes('msvc2019')) {
            return 'msvc2019';
        } else if (lowerPath.includes('msvc2017')) {
            return 'msvc2017';
        } else if (lowerPath.includes('msvc')) {
            return 'msvc';
        } else if (lowerPath.includes('mingw')) {
            return 'mingw';
        } else if (lowerPath.includes('gcc')) {
            return 'gcc';
        }
        
        return 'unknown';
    }
    
    /**
     * Get the appropriate make command for the Qt installation
     */
    getMakeCommand(qtInstallation?: QtInstallation): string {
        const config = vscode.workspace.getConfiguration('qt');
        const configuredMake = config.get<string>('makeCommand');
        
        // If user has configured a specific make command, use it
        if (configuredMake && configuredMake !== 'auto') {
            return configuredMake;
        }
        
        // Auto-detect based on compiler
        if (qtInstallation?.compiler) {
            const compiler = qtInstallation.compiler.toLowerCase();
            if (compiler.includes('msvc')) {
                // Check if jom is available (faster parallel build for MSVC)
                const jomPath = qtInstallation.qmakePath.replace('qmake.exe', 'jom.exe');
                if (fs.existsSync(jomPath)) {
                    return 'jom';
                }
                return 'nmake';
            } else if (compiler.includes('mingw')) {
                return 'mingw32-make';
            }
        }
        
        // Default fallback
        return 'nmake';
    }
    
    /**
     * Get build directory
     */
    getBuildDirectory(): string {
        const config = vscode.workspace.getConfiguration('qt');
        const buildDir = config.get<string>('buildDirectory') || '${workspaceFolder}/build';
        
        // Replace variables
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            return buildDir.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
        }
        
        return buildDir;
    }
    
    /**
     * Get build type for a specific project (falls back to global default)
     */
    getProjectBuildType(projectFile: string): string {
        const config = vscode.workspace.getConfiguration('qt');
        const perProject = config.get<Record<string, string>>('projectBuildConfigurations') || {};
        return perProject[projectFile] || config.get<string>('defaultBuildType') || 'debug';
    }

    /**
     * Set build type for a specific project
     */
    async setProjectBuildType(projectFile: string, buildType: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');
        const perProject = config.get<Record<string, string>>('projectBuildConfigurations') || {};
        perProject[projectFile] = buildType;
        await config.update('projectBuildConfigurations', perProject, vscode.ConfigurationTarget.Workspace);
    }

    /**
     * Clear cached installation (force re-detection)
     */
    clearCache(): void {
        this.cachedQtInstallation = undefined;
    }
}
