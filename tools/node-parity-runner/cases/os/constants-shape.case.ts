import type { ParityCase } from '../../src/types.ts';

// Prints VALUES for the darwin/linux-invariant subset so a mistyped table entry
// fails against real Node regardless of the host platform. Platform-divergent
// values (SIGBUS, SIGUSR*, errno >= 35, ...) are pinned by the conformance
// full-table test instead (tests/conformance/builtins/os.test.ts).
const c: ParityCase = {
  code: `
    const os = require('node:os');
    const sig = os.constants.signals;
    const err = os.constants.errno;
    const prio = os.constants.priority;
    // Identical numbers on darwin and linux:
    console.log(sig.SIGHUP, sig.SIGINT, sig.SIGQUIT, sig.SIGILL, sig.SIGTRAP, sig.SIGABRT);
    console.log(sig.SIGFPE, sig.SIGKILL, sig.SIGSEGV, sig.SIGPIPE, sig.SIGALRM, sig.SIGTERM);
    console.log(err.EPERM, err.ENOENT, err.ESRCH, err.EINTR, err.EIO, err.ENXIO);
    console.log(err.E2BIG, err.ENOEXEC, err.EBADF, err.ECHILD, err.ENOMEM, err.EACCES);
    console.log(err.EFAULT, err.EBUSY, err.EEXIST, err.EXDEV, err.ENODEV, err.ENOTDIR);
    console.log(err.EISDIR, err.EINVAL, err.ENFILE, err.EMFILE, err.ENOTTY, err.ETXTBSY);
    console.log(err.EFBIG, err.ENOSPC, err.ESPIPE, err.EROFS, err.EMLINK, err.EPIPE);
    console.log(err.EDOM, err.ERANGE);
    console.log(prio.PRIORITY_LOW, prio.PRIORITY_NORMAL, prio.PRIORITY_HIGHEST);
    // Shape probes for the platform-divergent remainder:
    console.log(typeof sig.SIGUSR1, typeof sig.SIGCHLD, typeof err.ECONNREFUSED);
    console.log(sig.SIGTERM !== sig.SIGINT);
  `,
};

export default c;
