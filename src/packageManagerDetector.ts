import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { isWindows, isMacOS, isLinux, exe } from './platformUtils';

export type PackageManagerSource =
    | 'homebrew'
    | 'apt'
    | 'pacman'
    | 'vcpkg'
    | 'conan'
    | 'aqtinstall'
    | 'yocto';

export interface PackageManagerResult {
    path: string;
    qmakePath: string;
    version: string;
    source: PackageManagerSource;
}

/**
 * Run a shell command and return stdout, or undefined on error.
 */
function runCommand(command: string, args?: string[]): string | undefined {
    try {
        const fullCmd = args ? `${command} ${args.join(' ')}` : command;
        return execSync(fullCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
        return undefined;
    }
}

/**
 * Run a shell command with a timeout and return stdout, or undefined on error.
 */
function runCommandWithTimeout(command: string, args?: string[], timeoutMs = 5000): string | undefined {
    try {
        const fullCmd = args ? `${command} ${args.join(' ')}` : command;
        return execSync(fullCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: timeoutMs }).trim();
    } catch {
        return undefined;
    }
}

/**
 * Query qmake for its version string.
 */
function queryQMakeVersion(qmakePath: string): string | undefined {
    const output = runCommand(`"${qmakePath}"`, ['-query', 'QT_VERSION']);
    return output || undefined;
}

/**
 * Query qmake for its install prefix.
 */
function queryQMakePrefix(qmakePath: string): string | undefined {
    const output = runCommand(`"${qmakePath}"`, ['-query', 'QT_INSTALL_PREFIX']);
    return output || undefined;
}

/**
 * Create a PackageManagerResult from a qmake path, verifying it works.
 */
function makeResult(qmakePath: string, source: PackageManagerSource): PackageManagerResult | undefined {
    if (!fs.existsSync(qmakePath)) {
        return undefined;
    }
    const version = queryQMakeVersion(qmakePath);
    const prefix = queryQMakePrefix(qmakePath);
    if (!version) {
        return undefined;
    }
    return {
        path: prefix || path.dirname(path.dirname(qmakePath)),
        qmakePath,
        version,
        source
    };
}

/**
 * Remove duplicate results by qmake path.
 */
function deduplicateResults(results: PackageManagerResult[]): PackageManagerResult[] {
    const seen = new Set<string>();
    return results.filter(r => {
        const normalized = r.qmakePath.toLowerCase();
        if (seen.has(normalized)) {
            return false;
        }
        seen.add(normalized);
        return true;
    });
}

// ---------------------------------------------------------------------------
// Homebrew detector (macOS + Linux)
// ---------------------------------------------------------------------------

export function detectHomebrewQt(): PackageManagerResult[] {
    const results: PackageManagerResult[] = [];
    if (isWindows()) {
        return results;
    }

    // Try versioned and unversioned formulae
    const formulae = ['qt@6', 'qt@5', 'qt'];
    for (const formula of formulae) {
        const prefix = runCommand('brew', ['--prefix', formula]);
        if (!prefix || !fs.existsSync(prefix)) {
            continue;
        }
        // qmake is typically at <prefix>/bin/qmake
        const qmakePath = path.join(prefix, 'bin', exe('qmake'));
        const result = makeResult(qmakePath, 'homebrew');
        if (result) {
            results.push(result);
        }
    }

    // Also try the Cellar path directly as fallback
    const cellarPaths = ['/opt/homebrew/Cellar', '/usr/local/Cellar', `${os.homedir()}/.linuxbrew/Cellar`];
    for (const cellar of cellarPaths) {
        if (!fs.existsSync(cellar)) {
            continue;
        }
        // Look for qt, qt@5, qt@6 directories in Cellar
        try {
            const dirs = fs.readdirSync(cellar, { withFileTypes: true })
                .filter(d => d.isDirectory() && /^(qt|qt@\d+)$/.test(d.name))
                .map(d => path.join(cellar, d.name));
            for (const qtDir of dirs) {
                try {
                    const versions = fs.readdirSync(qtDir, { withFileTypes: true })
                        .filter(d => d.isDirectory())
                        .map(d => path.join(qtDir, d.name));
                    for (const versionDir of versions) {
                        const qmakePath = path.join(versionDir, 'bin', exe('qmake'));
                        const result = makeResult(qmakePath, 'homebrew');
                        if (result) {
                            results.push(result);
                        }
                    }
                } catch {
                    // ignore unreadable dirs
                }
            }
        } catch {
            // ignore unreadable cellar
        }
    }

    return deduplicateResults(results);
}

// ---------------------------------------------------------------------------
// APT / DPKG detector (Debian / Ubuntu)
// ---------------------------------------------------------------------------

export function detectAptQt(): PackageManagerResult[] {
    const results: PackageManagerResult[] = [];
    if (!isLinux()) {
        return results;
    }

    // Standard APT Qt installation paths
    const aptPaths = [
        { base: '/usr/lib/x86_64-linux-gnu/qt6', qmakeRel: 'bin/qmake' },
        { base: '/usr/lib/x86_64-linux-gnu/qt5', qmakeRel: 'bin/qmake' },
        { base: '/usr/lib/aarch64-linux-gnu/qt6', qmakeRel: 'bin/qmake' },
        { base: '/usr/lib/aarch64-linux-gnu/qt5', qmakeRel: 'bin/qmake' },
        { base: '/usr/lib/qt6', qmakeRel: 'bin/qmake' },
        { base: '/usr/lib/qt5', qmakeRel: 'bin/qmake' },
    ];

    for (const { base, qmakeRel } of aptPaths) {
        if (!fs.existsSync(base)) {
            continue;
        }
        const qmakePath = path.join(base, qmakeRel);
        const result = makeResult(qmakePath, 'apt');
        if (result) {
            results.push(result);
        }
    }

    // Also try to find via dpkg to confirm package-managed installation
    const dpkgOutput = runCommand('dpkg', ['-S', 'qmake']);
    if (dpkgOutput) {
        // dpkg -S qmake returns lines like "qtbase5-dev: /usr/lib/qt5/bin/qmake"
        const lines = dpkgOutput.split('\n');
        for (const line of lines) {
            const match = line.match(/:\s*(.+)$/);
            if (match) {
                const foundPath = match[1].trim();
                const result = makeResult(foundPath, 'apt');
                if (result) {
                    results.push(result);
                }
            }
        }
    }

    return deduplicateResults(results);
}

// ---------------------------------------------------------------------------
// Pacman detector (Arch / Manjaro)
// ---------------------------------------------------------------------------

export function detectPacmanQt(): PackageManagerResult[] {
    const results: PackageManagerResult[] = [];
    if (!isLinux()) {
        return results;
    }

    // Standard Arch Qt paths
    const archPaths = [
        { base: '/usr/lib/qt6', qmakeRel: 'bin/qmake' },
        { base: '/usr/lib/qt5', qmakeRel: 'bin/qmake' },
        { base: '/usr/lib/qt', qmakeRel: 'bin/qmake' },
    ];

    for (const { base, qmakeRel } of archPaths) {
        if (!fs.existsSync(base)) {
            continue;
        }
        const qmakePath = path.join(base, qmakeRel);
        const result = makeResult(qmakePath, 'pacman');
        if (result) {
            results.push(result);
        }
    }

    // Try pacman -Ql to find qmake paths
    const packages = ['qt6-base', 'qt5-base', 'qt6-5compat'];
    for (const pkg of packages) {
        const qlOutput = runCommandWithTimeout('pacman', ['-Ql', pkg], 3000);
        if (!qlOutput) {
            continue;
        }
        const lines = qlOutput.split('\n');
        for (const line of lines) {
            // pacman -Ql output: "qt6-base /usr/lib/qt6/bin/qmake"
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2 && parts[1].endsWith(exe('qmake'))) {
                const result = makeResult(parts[1], 'pacman');
                if (result) {
                    results.push(result);
                }
            }
        }
    }

    return deduplicateResults(results);
}

// ---------------------------------------------------------------------------
// vcpkg detector (Cross-platform)
// ---------------------------------------------------------------------------

export function detectVcpkgQt(): PackageManagerResult[] {
    const results: PackageManagerResult[] = [];

    // Find vcpkg root
    let vcpkgRoot = process.env.VCPKG_ROOT;
    if (!vcpkgRoot) {
        // Try to find vcpkg in PATH
        const vcpkgPath = runCommand(isWindows() ? 'where' : 'which', ['vcpkg']);
        if (vcpkgPath) {
            const vcpkgExe = vcpkgPath.split('\n')[0].trim();
            vcpkgRoot = path.dirname(vcpkgExe);
        }
    }

    if (!vcpkgRoot || !fs.existsSync(vcpkgRoot)) {
        return results;
    }

    // Search for qtbase in vcpkg installed directory
    const installedDir = path.join(vcpkgRoot, 'installed');
    if (!fs.existsSync(installedDir)) {
        return results;
    }

    // Try vcpkg list to find installed Qt packages
    const vcpkgList = runCommandWithTimeout('vcpkg', ['list', 'qtbase'], 5000);
    if (vcpkgList) {
        const lines = vcpkgList.split('\n');
        for (const line of lines) {
            // Format: "qtbase:x64-windows                            6.5.0"
            const match = line.match(/^(qtbase:[^\s]+)\s+([\d.]+)/);
            if (match) {
                const triplet = match[1].split(':')[1]; // e.g., x64-windows
                const version = match[2];
                const tripletDir = path.join(installedDir, triplet);
                if (fs.existsSync(tripletDir)) {
                    const qmakePath = path.join(tripletDir, 'tools', 'qt6', 'bin', exe('qmake'));
                    const altQmakePath = path.join(tripletDir, 'tools', 'qt5', 'bin', exe('qmake'));
                    const fallbackQmake = path.join(tripletDir, 'bin', exe('qmake'));

                    for (const qp of [qmakePath, altQmakePath, fallbackQmake]) {
                        const result = makeResult(qp, 'vcpkg');
                        if (result) {
                            result.version = version;
                            results.push(result);
                            break;
                        }
                    }
                }
            }
        }
    }

    // Fallback: scan installed triplets for Qt directories
    try {
        const triplets = fs.readdirSync(installedDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        for (const triplet of triplets) {
            const toolsQt6 = path.join(installedDir, triplet, 'tools', 'qt6', 'bin', exe('qmake'));
            const toolsQt5 = path.join(installedDir, triplet, 'tools', 'qt5', 'bin', exe('qmake'));
            const binQmake = path.join(installedDir, triplet, 'bin', exe('qmake'));

            for (const qp of [toolsQt6, toolsQt5, binQmake]) {
                const result = makeResult(qp, 'vcpkg');
                if (result) {
                    results.push(result);
                    break;
                }
            }
        }
    } catch {
        // ignore
    }

    return deduplicateResults(results);
}

// ---------------------------------------------------------------------------
// Conan detector (Cross-platform)
// ---------------------------------------------------------------------------

export function detectConanQt(): PackageManagerResult[] {
    const results: PackageManagerResult[] = [];

    const homeDir = os.homedir();
    const conanCachePaths = [
        path.join(homeDir, '.conan', 'data', 'qt'),
        path.join(homeDir, '.conan2', 'p'),
    ];

    for (const cachePath of conanCachePaths) {
        if (!fs.existsSync(cachePath)) {
            continue;
        }

        try {
            if (cachePath.includes('.conan2')) {
                // Conan 2: flat package storage with metadata
                // Scan for qt package directories
                const entries = fs.readdirSync(cachePath, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) {
                        continue;
                    }
                    // Conan 2 package dir names are hashes; we need to look inside
                    const pkgPath = path.join(cachePath, entry.name);
                    // Look for bin/qmake
                    const qmakePath = path.join(pkgPath, 'bin', exe('qmake'));
                    const result = makeResult(qmakePath, 'conan');
                    if (result) {
                        results.push(result);
                    }
                }
            } else {
                // Conan 1: structured as ~/.conan/data/qt/<version>/<user>/<channel>/package/<pkg_id>/
                const versions = fs.readdirSync(cachePath, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .map(d => path.join(cachePath, d.name));

                for (const versionDir of versions) {
                    try {
                        const users = fs.readdirSync(versionDir, { withFileTypes: true })
                            .filter(d => d.isDirectory())
                            .map(d => path.join(versionDir, d.name));

                        for (const userDir of users) {
                            try {
                                const channels = fs.readdirSync(userDir, { withFileTypes: true })
                                    .filter(d => d.isDirectory())
                                    .map(d => path.join(userDir, d.name));

                                for (const channelDir of channels) {
                                    const packageDir = path.join(channelDir, 'package');
                                    if (!fs.existsSync(packageDir)) {
                                        continue;
                                    }
                                    try {
                                        const pkgs = fs.readdirSync(packageDir, { withFileTypes: true })
                                            .filter(d => d.isDirectory())
                                            .map(d => path.join(packageDir, d.name));

                                        for (const pkgIdDir of pkgs) {
                                            const qmakePath = path.join(pkgIdDir, 'bin', exe('qmake'));
                                            const result = makeResult(qmakePath, 'conan');
                                            if (result) {
                                                results.push(result);
                                            }
                                        }
                                    } catch {
                                        // ignore
                                    }
                                }
                            } catch {
                                // ignore
                            }
                        }
                    } catch {
                        // ignore
                    }
                }
            }
        } catch {
            // ignore
        }
    }

    return deduplicateResults(results);
}

// ---------------------------------------------------------------------------
// aqtinstall detector (Cross-platform)
// ---------------------------------------------------------------------------

export function detectAqtinstallQt(): PackageManagerResult[] {
    const results: PackageManagerResult[] = [];

    // aqtinstall typically installs to standard Qt directories
    // We look for aqt-specific markers to distinguish from official installer
    const aqtPaths = [
        path.join(os.homedir(), 'Qt'),
        path.join(os.homedir(), '.local', 'Qt'),
        'C:\\Qt',
        'C:\\Program Files\\Qt',
    ];

    for (const basePath of aqtPaths) {
        if (!fs.existsSync(basePath)) {
            continue;
        }

        // Look for aqtinstall marker files
        const markerFiles = ['.aqtinstall', 'aqtinstall.log', '.aqt'];
        let hasMarker = false;
        for (const marker of markerFiles) {
            if (fs.existsSync(path.join(basePath, marker))) {
                hasMarker = true;
                break;
            }
        }

        try {
            const versionDirs = fs.readdirSync(basePath, { withFileTypes: true })
                .filter(d => d.isDirectory() && /^\d+\.\d+/.test(d.name))
                .map(d => path.join(basePath, d.name));

            for (const versionDir of versionDirs) {
                try {
                    const compilerDirs = fs.readdirSync(versionDir, { withFileTypes: true })
                        .filter(d => d.isDirectory())
                        .map(d => path.join(versionDir, d.name));

                    for (const compilerDir of compilerDirs) {
                        const qmakePath = path.join(compilerDir, 'bin', exe('qmake'));
                        if (!fs.existsSync(qmakePath)) {
                            continue;
                        }
                        // If we found an aqt marker at the base, tag as aqtinstall
                        // Otherwise, check if this specific version dir has a marker
                        const isAqt = hasMarker ||
                            markerFiles.some(m => fs.existsSync(path.join(versionDir, m))) ||
                            markerFiles.some(m => fs.existsSync(path.join(compilerDir, m)));

                        const result = makeResult(qmakePath, isAqt ? 'aqtinstall' : 'aqtinstall');
                        if (result) {
                            results.push(result);
                        }
                    }
                } catch {
                    // ignore
                }
            }
        } catch {
            // ignore
        }
    }

    return deduplicateResults(results);
}

// ---------------------------------------------------------------------------
// Yocto SDK detector (Cross-platform, Linux-focused)
// ---------------------------------------------------------------------------

export function extractSysrootFromEnvScript(scriptPath: string): string | undefined {
    try {
        const content = fs.readFileSync(scriptPath, 'utf-8');
        const patterns = [
            /SDKTARGETSYSROOT="([^"]+)"/,
            /OECORE_TARGET_SYSROOT="([^"]+)"/,
            /export\s+SDKTARGETSYSROOT=([^\n]+)/,
            /export\s+OECORE_TARGET_SYSROOT=([^\n]+)/
        ];
        for (const pattern of patterns) {
            const match = content.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }
    } catch {
        // ignore
    }
    return undefined;
}

export function extractCrossPrefixFromEnvScript(scriptPath: string): string | undefined {
    try {
        const content = fs.readFileSync(scriptPath, 'utf-8');
        // Look for OE_CROSS_COMPILE or CROSS_COMPILE definitions
        const patterns = [
            /CROSS_COMPILE="([^"]+)"/,
            /OECORE_CROSS_COMPILE="([^"]+)"/,
            /export\s+CROSS_COMPILE=([^\n]+)/
        ];
        for (const pattern of patterns) {
            const match = content.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }
    } catch {
        // ignore
    }
    return undefined;
}

export function extractToolchainFileFromEnvScript(sysroot: string): string | undefined {
    const candidates = [
        path.join(sysroot, 'usr', 'share', 'cmake', 'OEToolchainConfig.cmake'),
        path.join(sysroot, 'usr', 'share', 'cmake', 'oetoolchain.cmake'),
        path.join(sysroot, 'opt', 'cmake-toolchain.cmake')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

export function findYoctoEnvScript(sysroot: string): string | undefined {
    try {
        let dir = sysroot;
        for (let i = 0; i < 4; i++) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.startsWith('environment-setup-')) {
                    return path.join(dir, entry.name);
                }
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                break;
            }
            dir = parent;
        }
    } catch {
        // ignore
    }
    return undefined;
}

export function detectYoctoSdkQt(): PackageManagerResult[] {
    const results: PackageManagerResult[] = [];

    const sdkBases = [
        process.env.OE_SDK_ROOT,
        process.env.SDKROOT,
        '/opt/poky',
        '/opt/yocto',
        path.join(os.homedir(), 'yocto-sdk')
    ].filter((p): p is string => !!p);

    for (const sdkBase of sdkBases) {
        if (!fs.existsSync(sdkBase)) {
            continue;
        }

        try {
            const entries = fs.readdirSync(sdkBase, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }
                const machine = entry.name;
                const envScript = path.join(sdkBase, machine, `environment-setup-${machine}`);
                if (!fs.existsSync(envScript)) {
                    continue;
                }

                const sysroot = extractSysrootFromEnvScript(envScript);
                if (!sysroot || !fs.existsSync(sysroot)) {
                    continue;
                }

                const qmakePath = path.join(sysroot, 'usr', 'bin', 'qmake');
                if (!fs.existsSync(qmakePath)) {
                    // Qt may also live under sysroot/usr/bin/qmake-qt5 or similar
                    const altQmakePaths = [
                        path.join(sysroot, 'usr', 'bin', 'qmake-qt5'),
                        path.join(sysroot, 'usr', 'bin', 'qmake-qt6')
                    ];
                    let foundAlt = false;
                    for (const alt of altQmakePaths) {
                        if (fs.existsSync(alt)) {
                            foundAlt = true;
                            break;
                        }
                    }
                    if (!foundAlt) {
                        continue;
                    }
                }

                const result = makeResult(qmakePath, 'yocto');
                if (result) {
                    results.push(result);
                }
            }
        } catch {
            // ignore
        }
    }

    return deduplicateResults(results);
}

// ---------------------------------------------------------------------------
// Orchestrator: detect from all package managers
// ---------------------------------------------------------------------------

export function detectAllPackageManagers(): PackageManagerResult[] {
    const allResults: PackageManagerResult[] = [];

    allResults.push(...detectHomebrewQt());
    allResults.push(...detectAptQt());
    allResults.push(...detectPacmanQt());
    allResults.push(...detectVcpkgQt());
    allResults.push(...detectConanQt());
    allResults.push(...detectAqtinstallQt());
    allResults.push(...detectYoctoSdkQt());

    return deduplicateResults(allResults);
}

/**
 * Get a user-friendly display name for a package manager source.
 */
export function sourceDisplayName(source: string | undefined): string {
    switch (source) {
        case 'homebrew': return 'Homebrew';
        case 'apt': return 'APT';
        case 'pacman': return 'Pacman';
        case 'vcpkg': return 'vcpkg';
        case 'conan': return 'Conan';
        case 'aqtinstall': return 'aqtinstall';
        case 'yocto': return 'Yocto SDK';
        case 'official': return 'Official';
        default: return 'Unknown';
    }
}
