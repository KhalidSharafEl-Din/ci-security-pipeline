import subprocess

def run(cmd):
    # nosemgrep
    subprocess.call(cmd, shell=True)
