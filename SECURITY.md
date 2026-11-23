# Security policy

## Supported versions

Security and data-loss fixes are provided for the newest published prerelease while Vellym is below 1.0. After 1.0, this file will list supported stable lines.

## Development server

The development server has no authentication. Its default loopback binding is
not a substitute for operating-system access controls. With `--host 0.0.0.0`,
anyone who can reach it can modify documents, upload images, commit content,
and push the current branch to its configured upstream. Use a trusted network;
do not expose it to the Internet. Installed plugins execute as local code and
must also be trusted.

## Reporting a vulnerability

Do not open a public issue for path traversal, arbitrary file access, code execution, credential exposure, or another exploitable vulnerability. Use GitHub's private vulnerability reporting for `tasclub/vellym`. If that option is unavailable, contact the maintainer address shown on the npm package.

Include the affected version, impact, minimal reproduction, and suggested mitigation. Never include real project documents or credentials.

Ordinary bugs without a security impact should use the public bug report form.
