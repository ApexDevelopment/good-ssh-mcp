import { resolveRemotePath } from './daemon/manager.js';
import assert from 'assert';
function runTests() {
    console.log('Running resolveRemotePath Unit Tests...');
    // 1. Linux/macOS tests
    // Absolute path remains unchanged (but normalized)
    assert.strictEqual(resolveRemotePath('linux', '/home/user', '/home/user/cwd', '/var/log/file.txt'), '/var/log/file.txt');
    // Relative path joined with CWD
    assert.strictEqual(resolveRemotePath('linux', '/home/user', '/home/user/cwd', 'file.txt'), '/home/user/cwd/file.txt');
    assert.strictEqual(resolveRemotePath('linux', '/home/user', '/home/user/cwd/', 'sub/file.txt'), '/home/user/cwd/sub/file.txt');
    // Tilde resolution
    assert.strictEqual(resolveRemotePath('linux', '/home/user', '/home/user/cwd', '~'), '/home/user');
    assert.strictEqual(resolveRemotePath('linux', '/home/user', '/home/user/cwd', '~/file.txt'), '/home/user/file.txt');
    // 2. Windows tests
    // Absolute path with drive letter remains absolute
    assert.strictEqual(resolveRemotePath('windows', 'C:\\Users\\user', 'C:\\Users\\user\\cwd', 'D:\\logs\\file.txt'), 'D:/logs/file.txt');
    // Absolute path with backslashes is normalized
    assert.strictEqual(resolveRemotePath('windows', 'C:\\Users\\user', 'C:\\Users\\user\\cwd', 'C:\\logs\\file.txt'), 'C:/logs/file.txt');
    // Relative path joined with CWD
    assert.strictEqual(resolveRemotePath('windows', 'C:\\Users\\user', 'C:\\Users\\user\\cwd', 'file.txt'), 'C:/Users/user/cwd/file.txt');
    assert.strictEqual(resolveRemotePath('windows', 'C:\\Users\\user', 'C:\\Users\\user\\cwd\\', 'sub\\file.txt'), 'C:/Users/user/cwd/sub/file.txt');
    // Tilde resolution
    assert.strictEqual(resolveRemotePath('windows', 'C:\\Users\\user', 'C:\\Users\\user\\cwd', '~'), 'C:/Users/user');
    assert.strictEqual(resolveRemotePath('windows', 'C:\\Users\\user', 'C:\\Users\\user\\cwd', '~/file.txt'), 'C:/Users/user/file.txt');
    assert.strictEqual(resolveRemotePath('windows', 'C:\\Users\\user', 'C:\\Users\\user\\cwd', '~\\file.txt'), 'C:/Users/user/file.txt');
    // Tilde prefix not matching home directories (treated as relative)
    assert.strictEqual(resolveRemotePath('linux', '/home/user', '/home/user/cwd', '~temp.txt'), '/home/user/cwd/~temp.txt');
    assert.strictEqual(resolveRemotePath('windows', 'C:\\Users\\user', 'C:\\Users\\user\\cwd', '~temp.txt'), 'C:/Users/user/cwd/~temp.txt');
    console.log('✓ All resolveRemotePath unit tests passed successfully!');
}
runTests();
