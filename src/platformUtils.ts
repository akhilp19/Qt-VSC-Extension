import * as path from 'path';

export type Platform = 'win32' | 'darwin' | 'linux';

export function getPlatform(): Platform {
    return process.platform as Platform;
}

export function isWindows(): boolean {
    return process.platform === 'win32';
}

export function isMacOS(): boolean {
    return process.platform === 'darwin';
}

export function isLinux(): boolean {
    return process.platform === 'linux';
}

/** Platform-appropriate executable extension */
export function exe(name: string): string {
    return isWindows() ? `${name}.exe` : name;
}

/** Quote a path for the current shell */
export function quotePath(p: string): string {
    return `"${p}"`;
}

/** Build a mkdir -p command */
export function mkdirCmd(dir: string): string {
    if (isWindows()) {
        return `if (-not (Test-Path ${quotePath(dir)})) { New-Item -ItemType Directory -Path ${quotePath(dir)} -Force | Out-Null }`;
    }
    return `mkdir -p ${quotePath(dir)}`;
}

/** Build a cd command */
export function cdCmd(dir: string): string {
    return `cd ${quotePath(dir)}`;
}

/** Build an execution command */
export function execCmd(exePath: string, args: string = ''): string {
    if (isWindows()) {
        return `& ${quotePath(exePath)} ${args}`;
    }
    return `${quotePath(exePath)} ${args}`;
}

/** Build a simple command (no quoting needed for first token) */
export function simpleExecCmd(cmd: string, args: string = ''): string {
    if (isWindows()) {
        return `& ${cmd} ${args}`;
    }
    return `${cmd} ${args}`;
}

/** Build an if-directory-exists conditional */
export function ifDirExistsCmd(dir: string, thenCmd: string): string {
    if (isWindows()) {
        return `if (Test-Path ${quotePath(dir)}) { ${thenCmd} }`;
    }
    return `if [ -d ${quotePath(dir)} ]; then ${thenCmd}; fi`;
}

/** Build a remove-directory command */
export function rmDirCmd(dir: string): string {
    if (isWindows()) {
        return `Remove-Item -Recurse -Force ${quotePath(dir)}`;
    }
    return `rm -rf ${quotePath(dir)}`;
}

/** Null redirect for suppressing errors */
export function nullRedirect(): string {
    if (isWindows()) {
        return '2>$null';
    }
    return '2>/dev/null';
}

/** Command separator between statements */
export function cmdSep(): string {
    if (isWindows()) {
        return '; ';
    }
    return ' && ';
}

/** Join multiple shell commands for the current platform */
export function joinCmds(...commands: string[]): string {
    const valid = commands.filter(c => c.length > 0);
    return valid.join(cmdSep());
}

/** Common Qt installation search paths per platform */
export function getQtSearchPaths(): string[] {
    const platform = getPlatform();
    const paths: string[] = [];
    
    if (platform === 'win32') {
        paths.push(
            'C:\\Qt',
            'C:\\Program Files\\Qt',
            'C:\\Program Files (x86)\\Qt'
        );
        if (process.env.USERPROFILE) {
            paths.push(path.join(process.env.USERPROFILE, 'Qt'));
        }
    } else if (platform === 'darwin') {
        paths.push(
            '/Users/' + (process.env.USER || '') + '/Qt',
            '/usr/local/Qt',
            '/opt/Qt',
            '/Applications/Qt'
        );
    } else if (platform === 'linux') {
        paths.push(
            '/usr/lib/qt6',
            '/usr/lib/qt5',
            '/usr/lib/qt',
            '/opt/qt6',
            '/opt/qt5',
            '/opt/qt',
            '/usr/local/qt6',
            '/usr/local/qt5',
            '/usr/local/qt'
        );
    }
    
    return paths.filter(p => p.length > 0);
}

/** Get the PATH-existence check command for the platform */
export function pathExeLookupCmd(exeName: string): string {
    return isWindows() ? `where ${exeName}` : `which ${exeName}`;
}

/** Platform-specific deploy tool name */
export function deployToolName(): string {
    if (isWindows()) { return 'windeployqt'; }
    if (isMacOS()) { return 'macdeployqt'; }
    return 'linuxdeployqt';
}
