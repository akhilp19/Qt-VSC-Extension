import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { isWindows } from './platformUtils';

export const buildExitCodes = new Map<string, number>();

export interface BuildTimingResult {
    success: boolean;
    logPath: string;
    buildDir: string;
}

/**
 * A Pseudoterminal that runs a shell command for a Qt build/rebuild task,
 * streams output to the user-visible terminal, and writes a structured log
 * file that can be parsed for per-file compile times.
 */
export class QtBuildPseudoterminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    readonly onDidWrite = this.writeEmitter.event;

    private closeEmitter = new vscode.EventEmitter<number | void>();
    readonly onDidClose = this.closeEmitter.event;

    private child?: ChildProcess;
    private logStream?: fs.WriteStream;
    private buffer = '';

    constructor(
        private command: string,
        private cwd: string,
        private env: NodeJS.ProcessEnv,
        private logPath: string,
        private outputChannel: vscode.OutputChannel,
        private buildId?: string
    ) {}

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        try {
            const logDir = path.dirname(this.logPath);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            this.logStream = fs.createWriteStream(this.logPath, { flags: 'w' });
        } catch (error) {
            this.outputChannel.appendLine(`[BuildTerminal] Failed to create log: ${error}`);
        }

        this.writeEmitter.fire(`Running: ${this.command}\r\n`);
        this.outputChannel.appendLine(`[BuildTerminal] ${this.command}`);

        const shell = isWindows() ? 'powershell.exe' : 'bash';
        const shellFlag = isWindows() ? '-Command' : '-c';

        this.child = spawn(shell, [shellFlag, this.command], {
            cwd: this.cwd,
            env: { ...process.env, ...this.env },
            windowsHide: true
        });

        this.child.stdout?.on('data', (data: Buffer) => {
            this.emitData(data.toString());
        });

        this.child.stderr?.on('data', (data: Buffer) => {
            this.emitData(data.toString());
        });

        this.logStream?.on('error', error => {
            this.outputChannel.appendLine(`[BuildTerminal] Log error: ${error.message}`);
            this.logStream = undefined;
        });

        this.child.on('error', (error) => {
            this.emitData(`\r\nProcess error: ${error.message}\r\n`);
            this.logStream?.end();
            this.finish(1);
        });

        this.child.on('close', (code, signal) => {
            this.flushBuffer();
            this.outputChannel.appendLine(`[BuildTerminal] Exited with code ${code ?? signal}`);
            // Analytics reads the log on task completion, so finish after writes flush.
            if (this.logStream) {
                this.logStream.end(() => this.finish(code ?? 1));
            } else {
                this.finish(code ?? 1);
            }
        });
    }

    private finished = false;

    private finish(code: number): void {
        if (this.finished) { return; }
        this.finished = true;
        if (this.buildId) { buildExitCodes.set(this.buildId, code); }
        this.closeEmitter.fire(code);
    }

    close(): void {
        if (!this.finished) { this.finish(1); }
        if (this.child && !this.child.killed) {
            this.child.kill('SIGTERM');
        }
        this.flushBuffer();
        this.logStream?.end();
    }

    handleInput(data: string): void {
        // Build tasks generally do not read stdin, but forward it if they do.
        if (this.child?.stdin?.writable) {
            this.child.stdin.write(data);
        }
    }

    private emitData(chunk: string): void {
        if (this.finished) { return; }
        this.writeEmitter.fire(chunk);
        this.buffer += chunk;
        // Normalize line endings and flush complete lines to the structured log.
        let idx: number;
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.substring(0, idx);
            this.buffer = this.buffer.substring(idx + 1);
            this.logLine(line);
        }
    }

    private flushBuffer(): void {
        if (this.buffer.length > 0) {
            this.logLine(this.buffer);
            this.buffer = '';
        }
    }

    private logLine(line: string): void {
        if (!this.logStream) { return; }
        // Strip trailing carriage returns for consistent JSON output.
        const clean = line.replace(new RegExp('\\r+$', 'g'), '');
        const entry = { ts: Date.now(), line: clean };
        this.logStream.write(JSON.stringify(entry) + '\n');
    }
}
