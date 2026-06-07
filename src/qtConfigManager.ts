import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { isWindows, getQtSearchPaths, pathExeLookupCmd, exe } from './platformUtils';
import { detectAllPackageManagers, sourceDisplayName } from './packageManagerDetector';

export interface QtInstallation {
    path: string;
    qmakePath: string;
    version?: string;
    compiler?: string;
    source?: string;
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
            const lookupCmd = pathExeLookupCmd('qmake');
            const qmakeInPath = execSync(lookupCmd, { encoding: 'utf-8' }).trim().split('\n')[0];
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
        
        // 4. Check package managers (Homebrew, apt, pacman, vcpkg, Conan, aqtinstall)
        const pmAutoDetect = config.get<boolean>('packageManagerAutoDetect') ?? true;
        if (pmAutoDetect) {
            try {
                const pmResults = detectAllPackageManagers();
                if (pmResults.length > 0) {
                    const preferred = config.get<string>('preferredPackageManager') || 'auto';
                    let chosen = pmResults[0];
                    if (preferred !== 'auto') {
                        const match = pmResults.find(r => r.source === preferred);
                        if (match) {
                            chosen = match;
                        }
                    }
                    this.outputChannel.appendLine(
                        `Found Qt ${chosen.version} via ${sourceDisplayName(chosen.source)} at ${chosen.path}`
                    );
                    const installation: QtInstallation = {
                        path: chosen.path,
                        qmakePath: chosen.qmakePath,
                        version: chosen.version,
                        compiler: this.detectCompiler(chosen.qmakePath),
                        source: chosen.source
                    };
                    this.cachedQtInstallation = installation;
                    return installation;
                }
            } catch (error) {
                this.outputChannel.appendLine(`Package manager detection failed: ${error}`);
            }
        }
        
        // 5. Search common installation directories
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
     * Find all Qt installations in common directories and package managers
     */
    async findQtInstallations(): Promise<QtInstallation[]> {
        const installations: QtInstallation[] = [];
        
        // 1. Package manager installations
        const config = vscode.workspace.getConfiguration('qt');
        const pmAutoDetect = config.get<boolean>('packageManagerAutoDetect') ?? true;
        if (pmAutoDetect) {
            try {
                const pmResults = detectAllPackageManagers();
                for (const pm of pmResults) {
                    installations.push({
                        path: pm.path,
                        qmakePath: pm.qmakePath,
                        version: pm.version,
                        compiler: this.detectCompiler(pm.qmakePath),
                        source: pm.source
                    });
                }
            } catch (error) {
                this.outputChannel.appendLine(`Package manager detection failed during scan: ${error}`);
            }
        }
        
        // 2. Official / common directory installations
        const searchPaths = getQtSearchPaths().filter(p => fs.existsSync(p));
        
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
                                const installation = await this.createInstallationFromQMake(qmakePath, 'official');
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
        const qmakePath = path.join(binPath, exe('qmake'));
        
        if (fs.existsSync(qmakePath)) {
            return qmakePath;
        }
        
        // Try without bin subdirectory
        const directQmakePath = path.join(dirPath, exe('qmake'));
        if (fs.existsSync(directQmakePath)) {
            return directQmakePath;
        }
        
        return undefined;
    }
    
    /**
     * Create Qt installation object from qmake path
     */
    private async createInstallationFromQMake(qmakePath: string, source?: string): Promise<QtInstallation | undefined> {
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
                compiler: compiler,
                source: source
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
        } else if (lowerPath.includes('clang')) {
            return 'clang';
        } else if (lowerPath.includes('apple')) {
            return 'apple-clang';
        }
        
        if (!isWindows()) {
            // On Unix, try to detect from qmake spec
            try {
                const spec = execSync(`"${qmakePath}" -query QMAKE_XSPEC`, { encoding: 'utf-8' }).trim();
                if (spec.includes('clang')) { return 'clang'; }
                if (spec.includes('gcc') || spec.includes('g++')) { return 'gcc'; }
                if (spec.includes('macx')) { return 'apple-clang'; }
            } catch {
                // ignore
            }
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
                const jomPath = qtInstallation.qmakePath.replace(exe('qmake'), exe('jom'));
                if (fs.existsSync(jomPath)) {
                    return 'jom';
                }
                return 'nmake';
            } else if (compiler.includes('mingw')) {
                return 'mingw32-make';
            } else if (compiler.includes('gcc') || compiler.includes('clang') || compiler.includes('apple')) {
                return 'make';
            }
        }
        
        // Platform default fallback
        if (isWindows()) {
            return 'nmake';
        }
        return 'make';
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
     * Get parallel job count for builds
     */
    getParallelJobs(): number {
        const config = vscode.workspace.getConfiguration('qt');
        const jobs = config.get<number>('parallelJobs');
        if (jobs && jobs > 0) {
            return jobs;
        }
        // Auto-detect: use CPU count, capped at reasonable limits
        const cpus = require('os').cpus().length;
        return Math.max(1, Math.min(cpus, 16));
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
