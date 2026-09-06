import Darwin
import Foundation
import MachO

#if !DEBUG
@_silgen_name("ptrace")
private func phim4k_ptrace(
    _ request: Int32,
    _ pid: pid_t,
    _ address: UnsafeMutableRawPointer?,
    _ data: Int32
) -> Int32
#endif

/// Release-only runtime hardening. This intentionally avoids private iOS APIs
/// so an IPA may still be re-signed with ESign as long as its bundle ID and
/// packaged application are not rewritten.
enum RuntimeIntegrityGuard {
    private static let expectedBundleIdentifier = ["com", "phim4k", "cinema"].joined(separator: ".")
    private static var monitor: Timer?

    @discardableResult
    static func enforceAtLaunch() -> Bool {
        #if DEBUG
        return true
        #else
        guard validateRuntime(), validatePackagedResources() else {
            terminateCompromisedProcess()
            return false
        }

        // PT_DENY_ATTACH (31) prevents a debugger from attaching after the
        // initial launch check. Re-signing does not alter this behavior.
        _ = phim4k_ptrace(31, 0, nil, 0)
        startContinuousMonitoring()
        return true
        #endif
    }

    static func enforceWhenActive() {
        #if !DEBUG
        guard validateRuntime() else {
            terminateCompromisedProcess()
            return
        }
        #endif
    }

    private static func validateRuntime() -> Bool {
        guard Bundle.main.bundleIdentifier == expectedBundleIdentifier else { return false }
        guard hasExpectedExecutableLocation() else { return false }
        guard !isDebuggerAttached() else { return false }
        guard !hasSuspiciousEnvironment() else { return false }
        guard !hasSuspiciousLoadedImage() else { return false }
        guard !hasKnownInjectionArtifact() else { return false }
        return true
    }

    private static func validatePackagedResources() -> Bool {
        RuntimeIntegrityManifest.verify()
    }

    private static func hasExpectedExecutableLocation() -> Bool {
        guard
            let executableName = Bundle.main.object(forInfoDictionaryKey: "CFBundleExecutable") as? String,
            !executableName.isEmpty,
            !executableName.contains("/"),
            let executableURL = Bundle.main.executableURL?.standardizedFileURL
        else { return false }

        let expectedURL = Bundle.main.bundleURL
            .appendingPathComponent(executableName, isDirectory: false)
            .standardizedFileURL
        return executableURL == expectedURL
    }

    private static func isDebuggerAttached() -> Bool {
        var processInfo = kinfo_proc()
        var processInfoSize = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        let result = mib.withUnsafeMutableBufferPointer { pointer in
            sysctl(pointer.baseAddress, u_int(pointer.count), &processInfo, &processInfoSize, nil, 0)
        }
        guard result == 0 else { return true }
        return (processInfo.kp_proc.p_flag & 0x00000800) != 0 // P_TRACED
    }

    private static func hasSuspiciousEnvironment() -> Bool {
        let environment = ProcessInfo.processInfo.environment
        let forbiddenKeys = [
            "DYLD_INSERT_LIBRARIES",
            "_MSSafeMode",
            "FRIDA_AGENT_CONFIG",
            "LIBHOOKER_CONFIGURATOR_PATH",
        ]
        return forbiddenKeys.contains { !(environment[$0] ?? "").isEmpty }
    }

    private static func hasSuspiciousLoadedImage() -> Bool {
        let markers = [
            "frida", "fridagadget", "mobilesubstrate", "substrate",
            "substitute", "ellekit", "libhooker", "cycript",
            "/tweakinject/", "/usr/lib/tweak/", "revealserver", "flex.dylib",
        ]
        let count = _dyld_image_count()
        if count > 2_048 { return true }
        for index in 0..<count {
            guard let imageName = _dyld_get_image_name(index) else { continue }
            let path = String(cString: imageName).lowercased()
            if markers.contains(where: path.contains) { return true }
        }
        return false
    }

    private static func hasKnownInjectionArtifact() -> Bool {
        let paths = [
            "/Library/MobileSubstrate/MobileSubstrate.dylib",
            "/usr/lib/libsubstitute.dylib",
            "/usr/lib/libhooker.dylib",
            "/usr/lib/ellekit/ElleKit.dylib",
            "/usr/sbin/frida-server",
            "/var/jb/usr/sbin/frida-server",
            "/var/jb/Library/MobileSubstrate/MobileSubstrate.dylib",
        ]
        return paths.contains { FileManager.default.fileExists(atPath: $0) }
    }

    private static func startContinuousMonitoring() {
        guard monitor == nil else { return }
        DispatchQueue.main.async {
            guard monitor == nil else { return }
            let timer = Timer(timeInterval: 4, repeats: true) { _ in
                enforceWhenActive()
            }
            RunLoop.main.add(timer, forMode: .common)
            monitor = timer
        }
    }

    private static func terminateCompromisedProcess() -> Never {
        monitor?.invalidate()
        monitor = nil
        kill(getpid(), SIGKILL)
        fatalError("Runtime integrity failure")
    }
}
