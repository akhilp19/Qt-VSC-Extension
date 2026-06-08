import * as path from 'path';
import * as fs from 'fs';

export interface PlatformConfig {
    os: string;
    qtArch: string;
    compiler: string;
    label: string;
}

export interface CiOptions {
    projectType: 'qmake' | 'cmake';
    projectFile: string;
    projectName: string;
    qtVersion: string;
    platforms: PlatformConfig[];
    qtModules: string[];
}

export const KNOWN_QT_VERSIONS = ['6.8.0', '6.7.0', '6.6.0', '6.5.0', '5.15.2'];

export const DEFAULT_PLATFORMS: PlatformConfig[] = [
    { os: 'windows-latest', qtArch: 'win64_msvc2022_64', compiler: 'msvc2022', label: 'Windows (MSVC 2022)' },
    { os: 'macos-latest', qtArch: 'clang_64', compiler: 'clang', label: 'macOS (Clang)' },
    { os: 'ubuntu-latest', qtArch: 'gcc_64', compiler: 'gcc', label: 'Linux (GCC)' }
];

export function detectProjectFile(workspacePath: string): { type: 'qmake' | 'cmake'; file: string; name: string } | undefined {
    try {
        const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.pro')) {
                return { type: 'qmake', file: entry.name, name: path.basename(entry.name, '.pro') };
            }
        }
        for (const entry of entries) {
            if (entry.isFile() && entry.name === 'CMakeLists.txt') {
                return { type: 'cmake', file: entry.name, name: path.basename(workspacePath) };
            }
        }
    } catch {
        // ignore
    }
    return undefined;
}

export function generateGitHubBuildYml(options: CiOptions): string {
    const lines: string[] = [];
    lines.push('name: Build Qt Project');
    lines.push('');
    lines.push('on:');
    lines.push('  push:');
    lines.push('    branches: [main, master]');
    lines.push('  pull_request:');
    lines.push('    branches: [main, master]');
    lines.push('');
    lines.push('jobs:');
    lines.push('  build:');
    lines.push('    strategy:');
    lines.push('      fail-fast: false');
    lines.push('      matrix:');
    lines.push('        include:');

    for (const platform of options.platforms) {
        lines.push(`          - os: ${platform.os}`);
        lines.push(`            qt_arch: ${platform.qtArch}`);
        lines.push(`            compiler: ${platform.compiler}`);
    }

    lines.push('');
    lines.push('    runs-on: ${{ matrix.os }}');
    lines.push('');
    lines.push('    steps:');
    lines.push('      - name: Checkout');
    lines.push('        uses: actions/checkout@v4');
    lines.push('');
    lines.push('      - name: Install Qt');
    lines.push('        uses: jurplel/install-qt-action@v4');
    lines.push('        with:');
    lines.push(`          version: '${options.qtVersion}'`);
    lines.push('          arch: ${{ matrix.qt_arch }}');
    lines.push('          cache: true');

    if (options.qtModules.length > 0) {
        const modules = options.qtModules.filter(m => m !== 'core').join(' ');
        if (modules) {
            lines.push(`          modules: '${modules}'`);
        }
    }

    lines.push('');

    if (options.projectType === 'qmake') {
        lines.push('      - name: Build (QMake)');
        lines.push('        shell: bash');
        lines.push('        run: |');
        lines.push('          qmake "${{ github.workspace }}"/' + options.projectFile);
        lines.push('          make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)');
    } else {
        lines.push('      - name: Build (CMake)');
        lines.push('        run: |');
        lines.push('          cmake -B build -S . -DCMAKE_BUILD_TYPE=Release');
        lines.push('          cmake --build build --parallel');
    }

    lines.push('');
    lines.push('      - name: Upload Artifact');
    lines.push('        uses: actions/upload-artifact@v4');
    lines.push('        with:');
    lines.push('          name: build-${{ matrix.os }}');
    if (options.projectType === 'qmake') {
        lines.push('          path: |');
        lines.push('            *.exe');
        lines.push('            *.app');
        lines.push('            *.so');
        lines.push('            *.dylib');
    } else {
        lines.push('          path: build/');
    }

    lines.push('');
    return lines.join('\n');
}

export function generateGitHubReleaseYml(options: CiOptions): string {
    const lines: string[] = [];
    lines.push('name: Release Qt Project');
    lines.push('');
    lines.push('on:');
    lines.push('  push:');
    lines.push('    tags:');
    lines.push("      - 'v*.*.*'");
    lines.push('');
    lines.push('jobs:');
    lines.push('  build:');
    lines.push('    strategy:');
    lines.push('      fail-fast: false');
    lines.push('      matrix:');
    lines.push('        include:');

    for (const platform of options.platforms) {
        lines.push(`          - os: ${platform.os}`);
        lines.push(`            qt_arch: ${platform.qtArch}`);
        lines.push(`            compiler: ${platform.compiler}`);
    }

    lines.push('');
    lines.push('    runs-on: ${{ matrix.os }}');
    lines.push('');
    lines.push('    steps:');
    lines.push('      - name: Checkout');
    lines.push('        uses: actions/checkout@v4');
    lines.push('');
    lines.push('      - name: Install Qt');
    lines.push('        uses: jurplel/install-qt-action@v4');
    lines.push('        with:');
    lines.push(`          version: '${options.qtVersion}'`);
    lines.push('          arch: ${{ matrix.qt_arch }}');
    lines.push('          cache: true');
    lines.push('');

    if (options.projectType === 'qmake') {
        lines.push('      - name: Build (QMake)');
        lines.push('        shell: bash');
        lines.push('        run: |');
        lines.push('          qmake "${{ github.workspace }}"/' + options.projectFile);
        lines.push('          make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)');
    } else {
        lines.push('      - name: Build (CMake)');
        lines.push('        run: |');
        lines.push('          cmake -B build -S . -DCMAKE_BUILD_TYPE=Release');
        lines.push('          cmake --build build --parallel');
    }

    lines.push('');
    lines.push('      - name: Package');
    lines.push('        shell: bash');
    lines.push('        run: |');
    lines.push('          mkdir -p dist');
    if (options.projectType === 'qmake') {
        lines.push('          cp $(find . -maxdepth 1 -type f \( -name "*.exe" -o -name "*.app" \) 2>/dev/null) dist/ 2>/dev/null || true');
    } else {
        lines.push('          cp -r build/* dist/ 2>/dev/null || true');
    }
    lines.push('');
    lines.push('      - name: Upload Artifact');
    lines.push('        uses: actions/upload-artifact@v4');
    lines.push('        with:');
    lines.push('          name: ${{ matrix.os }}');
    lines.push('          path: dist/');
    lines.push('');

    lines.push('  release:');
    lines.push('    needs: build');
    lines.push('    runs-on: ubuntu-latest');
    lines.push('    steps:');
    lines.push('      - name: Download Artifacts');
    lines.push('        uses: actions/download-artifact@v4');
    lines.push('        with:');
    lines.push('          path: artifacts/');
    lines.push('');
    lines.push('      - name: Create Release');
    lines.push('        uses: softprops/action-gh-release@v2');
    lines.push('        with:');
    lines.push('          files: artifacts/**/*');
    lines.push('          generate_release_notes: true');
    lines.push('        env:');
    lines.push('          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}');

    lines.push('');
    return lines.join('\n');
}

export function generateGitLabCiYml(options: CiOptions): string {
    const lines: string[] = [];
    lines.push('variables:');
    lines.push(`  QT_VERSION: "${options.qtVersion}"`);
    lines.push('');
    lines.push('stages:');
    lines.push('  - build');
    lines.push('');

    // Linux build
    lines.push('build:linux:');
    lines.push('  stage: build');
    lines.push('  image: ubuntu:latest');
    lines.push('  before_script:');
    lines.push('    - apt-get update -qq && apt-get install -y -qq build-essential libgl1-mesa-dev python3-pip');
    lines.push('    - pip3 install aqtinstall');
    lines.push('    - aqt install-qt linux desktop $QT_VERSION gcc_64 -O /opt/Qt');
    lines.push('  script:');
    lines.push('    - export PATH=/opt/Qt/$QT_VERSION/gcc_64/bin:$PATH');

    if (options.projectType === 'qmake') {
        lines.push(`    - qmake ${options.projectFile}`);
        lines.push('    - make -j$(nproc)');
    } else {
        lines.push('    - cmake -B build -S . -DCMAKE_BUILD_TYPE=Release');
        lines.push('    - cmake --build build --parallel');
    }

    lines.push('  artifacts:');
    lines.push('    paths:');
    if (options.projectType === 'qmake') {
        lines.push('      - ./*.exe');
        lines.push('      - ./*.so');
    } else {
        lines.push('      - build/');
    }
    lines.push('');

    return lines.join('\n');
}
