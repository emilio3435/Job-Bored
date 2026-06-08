import re
import sys

# Redact real secret values, not just literal asterisk runs.
# Each pattern captures a leading group to preserve (e.g. the key name and
# separator) and replaces the secret value that follows with REDACTED.
REDACTION_RULES = [
    # Authorization headers: redact the whole credential after the scheme so a
    # "Bearer <token>" / "Basic <b64>" value can't survive (the generic
    # KEY=value rule below would only catch the scheme word).
    (
        re.compile(r"(?i)(authorization[ \t]*[:=][ \t]*)(bearer|basic|token)?[ \t]*\S+"),
        r"\1REDACTED",
    ),
    # KEY=value / KEY: value assignments for secret-ish key names (env, yaml, ini).
    # The [A-Z0-9_]{0,64} bounds (vs unbounded *) keep matching linear on long
    # keyword-like lines that lack a separator (avoids quadratic backtracking).
    (
        re.compile(
            r"(?im)^([ \t]*(?:export[ \t]+)?[A-Z0-9_]{0,64}"
            r"(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL|PRIVATE|AUTH|API|ACCESS)"
            r"[A-Z0-9_]{0,64}[ \t]*[:=][ \t]*)"
            r"(?:\"[^\"]*\"|'[^']*'|\S+)"
        ),
        r"\1REDACTED",
    ),
    # Credentials embedded in URLs: scheme://user:PASSWORD@host -> redact password.
    (
        re.compile(r"([a-zA-Z][a-zA-Z0-9+.\-]*://[^/\s:@]+:)[^@\s/]+(@)"),
        r"\1REDACTED\2",
    ),
    # "key": "value" JSON-style entries with secret-ish key names.
    (
        re.compile(
            r"(?i)(\"[A-Za-z0-9_]*"
            r"(?:key|secret|token|password|passwd|credential|private|auth)"
            r"[A-Za-z0-9_]*\"[ \t]*:[ \t]*)"
            r"\"[^\"]*\""
        ),
        r'\1"REDACTED"',
    ),
    # Known provider token shapes (match the value itself anywhere).
    (re.compile(r"AIza[0-9A-Za-z_\-]{20,}"), "REDACTED"),            # Google API key
    (re.compile(r"sk-ant-[0-9A-Za-z_\-]{20,}"), "REDACTED"),         # Anthropic
    (re.compile(r"sk-[0-9A-Za-z]{20,}"), "REDACTED"),                # OpenAI
    (re.compile(r"sk_(?:live|test)_[0-9A-Za-z]{10,}"), "REDACTED"),  # Stripe secret key
    (re.compile(r"gh[pousr]_[0-9A-Za-z]{20,}"), "REDACTED"),         # GitHub tokens
    (re.compile(r"xox[baprs]-[0-9A-Za-z\-]{10,}"), "REDACTED"),      # Slack bot/user
    (re.compile(r"xapp-[0-9A-Za-z\-]{10,}"), "REDACTED"),            # Slack app-level
    (re.compile(r"GOCSPX-[0-9A-Za-z_\-]{10,}"), "REDACTED"),         # Google OAuth client secret
    (re.compile(r"AKIA[0-9A-Z]{16}"), "REDACTED"),                   # AWS access key id
    (re.compile(r"ya29\.[0-9A-Za-z_\-]{20,}"), "REDACTED"),          # Google OAuth token
    (
        re.compile(r"eyJ[0-9A-Za-z_\-]{6,}\.eyJ[0-9A-Za-z_\-]{6,}\.[0-9A-Za-z_\-]{6,}"),
        "REDACTED",
    ),                                                               # JWT (header.payload.sig)
    (
        re.compile(
            r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----"
            r".*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----",
            re.DOTALL,
        ),
        "-----BEGIN PRIVATE KEY-----\nREDACTED\n-----END PRIVATE KEY-----",
    ),
    # Collapse pre-existing asterisk-masked runs (preserves original behavior),
    # bounded so it cannot greedily swallow unrelated content.
    (re.compile(r"\*{4,}"), "REDACTED"),
]


def redact(content):
    for pattern, replacement in REDACTION_RULES:
        content = pattern.sub(replacement, content)
    return content


def main():
    if len(sys.argv) < 2:
        print("usage: redact_secrets.py <file> [<file> ...]", file=sys.stderr)
        return 2
    for filepath in sys.argv[1:]:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        redacted = redact(content)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(redacted)
        print(f"Done: {filepath}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
