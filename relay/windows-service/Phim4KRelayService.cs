using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Threading;

namespace Phim4KRelay
{
    internal sealed class RelayService : ServiceBase
    {
        private readonly object gate = new object();
        private Process child;
        private IntPtr childJob = IntPtr.Zero;
        private Timer restartTimer;
        private bool stopping;
        private readonly string serviceDirectory;
        private readonly string projectDirectory;
        private readonly string supervisorPath;
        private readonly string logPath;

        public RelayService()
        {
            ServiceName = "Phim4KMediaRelay";
            CanStop = true;
            CanShutdown = true;
            AutoLog = false;
            serviceDirectory = AppDomain.CurrentDomain.BaseDirectory;
            projectDirectory = Path.GetFullPath(Path.Combine(serviceDirectory, "..", ".."));
            supervisorPath = Path.Combine(projectDirectory, "relay", "supervisor.mjs");
            logPath = Path.Combine(projectDirectory, "relay", "logs", "service.log");
        }

        protected override void OnStart(string[] args)
        {
            stopping = false;
            Directory.CreateDirectory(Path.GetDirectoryName(logPath));
            WriteLog("service starting");
            StartSupervisor();
        }

        protected override void OnStop()
        {
            StopManagedProcesses("service stop");
        }

        protected override void OnShutdown()
        {
            StopManagedProcesses("system shutdown");
            base.OnShutdown();
        }

        private void StartSupervisor()
        {
            lock (gate)
            {
                if (stopping || (child != null && !child.HasExited)) return;
                if (!File.Exists(supervisorPath)) throw new FileNotFoundException("Relay supervisor is missing", supervisorPath);
                const string nodePath = @"C:\Program Files\nodejs\node.exe";
                if (!File.Exists(nodePath)) throw new FileNotFoundException("Node.js is missing", nodePath);

                var startInfo = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = "\"" + supervisorPath + "\"",
                    WorkingDirectory = projectDirectory,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                child = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
                child.Exited += SupervisorExited;
                if (!child.Start()) throw new InvalidOperationException("Unable to start relay supervisor");
                childJob = CreateKillOnCloseJob();
                if (!AssignProcessToJobObject(childJob, child.Handle))
                {
                    CloseHandle(childJob);
                    childJob = IntPtr.Zero;
                    child.Kill();
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to contain relay process tree");
                }
                WriteLog("supervisor started");
            }
        }

        private void SupervisorExited(object sender, EventArgs args)
        {
            lock (gate)
            {
                if (stopping) return;
                CloseChildJob();
                WriteLog("supervisor exited; scheduling restart");
                if (restartTimer != null) restartTimer.Dispose();
                restartTimer = new Timer(_ =>
                {
                    try { StartSupervisor(); }
                    catch (Exception error) { WriteLog("restart failed: " + Safe(error.Message)); }
                }, null, TimeSpan.FromSeconds(5), Timeout.InfiniteTimeSpan);
            }
        }

        private void StopManagedProcesses(string reason)
        {
            lock (gate)
            {
                if (stopping) return;
                stopping = true;
                if (restartTimer != null) restartTimer.Dispose();
                CloseChildJob();
            }
            WriteLog(reason);
        }

        private void CloseChildJob()
        {
            if (childJob == IntPtr.Zero) return;
            CloseHandle(childJob);
            childJob = IntPtr.Zero;
        }

        private static IntPtr CreateKillOnCloseJob()
        {
            var handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to create relay job object");
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            var length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            var pointer = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(info, pointer, false);
                if (!SetInformationJobObject(handle, 9, pointer, (uint)length))
                {
                    CloseHandle(handle);
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to configure relay job object");
                }
            }
            finally { Marshal.FreeHGlobal(pointer); }
            return handle;
        }

        private static string Safe(string value)
        {
            return (value ?? "error").Replace("\r", " ").Replace("\n", " ").Substring(0, Math.Min(300, (value ?? "error").Length));
        }

        private void WriteLog(string message)
        {
            try { File.AppendAllText(logPath, DateTime.UtcNow.ToString("o") + " " + Safe(message) + Environment.NewLine); }
            catch { }
        }

        public static void Main()
        {
            ServiceBase.Run(new RelayService());
        }

        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);
    }
}
