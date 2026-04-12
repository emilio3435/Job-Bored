import re
import sys

filepath = sys.argv[1]
with open(filepath, 'r') as f:
    content = f.read()

# Replace any asterisk sequences (secrets) with REDACTED
content = re.sub(r'\*{2,}[^"]*', 'REDACTED', content)

with open(filepath, 'w') as f:
    f.write(content)
print(f'Done: {filepath}')
