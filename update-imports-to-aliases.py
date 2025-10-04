#!/usr/bin/env python3
import os
import re
from pathlib import Path

def update_imports_to_aliases(file_path):
    """Update imports to use aliases instead of relative paths"""

    # Read the file
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content

    # Replace relative imports with aliases
    patterns = [
        # Match imports from '../constants' or '../../constants' etc.
        (r"from\s+['\"]\.\.+/constants['\"]", "from '@constants'"),
        (r"from\s+['\"]\.\.+/constants/([^'\"]+)['\"]", r"from '@constants/\1'"),
        (r"from\s+['\"]./constants['\"]", "from '@constants'"),
        (r"from\s+['\"]./constants/([^'\"]+)['\"]", r"from '@constants/\1'"),

        # Types
        (r"from\s+['\"]\.\.+/types['\"]", "from '@types'"),
        (r"from\s+['\"]\.\.+/types/([^'\"]+)['\"]", r"from '@types/\1'"),
        (r"from\s+['\"]./types['\"]", "from '@types'"),
        (r"from\s+['\"]./types/([^'\"]+)['\"]", r"from '@types/\1'"),

        # Utils
        (r"from\s+['\"]\.\.+/utils['\"]", "from '@utils'"),
        (r"from\s+['\"]\.\.+/utils/([^'\"]+)['\"]", r"from '@utils/\1'"),
        (r"from\s+['\"]./utils['\"]", "from '@utils'"),
        (r"from\s+['\"]./utils/([^'\"]+)['\"]", r"from '@utils/\1'"),

        # Schemas
        (r"from\s+['\"]\.\.+/schemas['\"]", "from '@schemas'"),
        (r"from\s+['\"]\.\.+/schemas/([^'\"]+)['\"]", r"from '@schemas/\1'"),
        (r"from\s+['\"]./schemas['\"]", "from '@schemas'"),
        (r"from\s+['\"]./schemas/([^'\"]+)['\"]", r"from '@schemas/\1'"),

        # Also handle CommonJS require
        (r"require\(['\"]\.\.+/constants['\"]", "require('@constants'"),
        (r"require\(['\"]\.\.+/constants/([^'\"]+)['\"]", r"require('@constants/\1'"),
        (r"require\(['\"]\.\.+/types['\"]", "require('@types'"),
        (r"require\(['\"]\.\.+/types/([^'\"]+)['\"]", r"require('@types/\1'"),
        (r"require\(['\"]\.\.+/utils['\"]", "require('@utils'"),
        (r"require\(['\"]\.\.+/utils/([^'\"]+)['\"]", r"require('@utils/\1'"),
        (r"require\(['\"]\.\.+/schemas['\"]", "require('@schemas'"),
        (r"require\(['\"]\.\.+/schemas/([^'\"]+)['\"]", r"require('@schemas/\1'"),
    ]

    # Apply all replacements
    for pattern, replacement in patterns:
        content = re.sub(pattern, replacement, content)

    # Write back if changed
    if content != original_content:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

def main():
    src_dir = Path('/home/kennedy/ankaa/separating/api/src')

    fixed_count = 0

    # Process all TypeScript files
    for file_path in src_dir.rglob('*.ts'):
        if file_path.is_file():
            if update_imports_to_aliases(str(file_path)):
                fixed_count += 1
                print(f"Fixed: {file_path.relative_to(src_dir)}")

    print(f"\nTotal files updated: {fixed_count}")

if __name__ == "__main__":
    main()