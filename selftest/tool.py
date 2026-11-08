import subprocess
import sys

# Planted SAST finding: shell=True with input from the command line.
subprocess.call("grep " + sys.argv[1] + " /var/log/app.log", shell=True)
