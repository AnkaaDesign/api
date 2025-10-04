#!/usr/bin/env python3
import os
import re
from pathlib import Path

def fix_import_paths(file_path):
    """Fix import paths to point to the correct location"""

    # Read the file
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content

    # Get the relative path from src
    rel_path = Path(file_path).relative_to(Path('/home/kennedy/ankaa/separating/api/src'))
    depth = len(rel_path.parts) - 1  # Subtract 1 for the file itself

    # Files in src root need './' prefix
    if depth == 0:
        prefix = './'
    # Files in subdirectories need appropriate '../' levels
    else:
        prefix = '../' * depth

    # Define the packages and their paths
    packages = ['constants', 'types', 'utils', 'schemas']

    for package in packages:
        # Fix imports with any number of '../' - from 1 to 10 levels
        for level in range(1, 11):
            dots = '../' * level

            # Fix ES6 imports
            pattern = rf"from ['\"]\.\./{dots.rstrip('/')}/{package}(?:/[^'\"]*)?['\"]"

            def replace_import(match):
                import_str = match.group(0)
                # Extract subpath if exists
                if f'/{package}/' in import_str:
                    subpath = import_str.split(f'/{package}/')[1].rstrip('"\'')
                    return f"from '{prefix}{package}/{subpath}'"
                else:
                    return f"from '{prefix}{package}'"

            content = re.sub(pattern, replace_import, content)

            # Also handle simpler patterns like '../../../../schemas'
            simple_pattern = rf"from ['\"]{'../' * (level + 1)}{package}(?:/[^'\"]*)?['\"]"
            content = re.sub(simple_pattern, replace_import, content)

            # Fix require() style imports
            require_pattern = rf"require\(['\"]{'../' * (level + 1)}{package}(?:/[^'\"]*)?['\"]\)"

            def replace_require(match):
                import_str = match.group(0)
                if f'/{package}/' in import_str:
                    subpath = import_str.split(f'/{package}/')[1].rstrip('"\'))')
                    return f"require('{prefix}{package}/{subpath}')"
                else:
                    return f"require('{prefix}{package}')"

            content = re.sub(require_pattern, replace_require, content)

    # Also fix express.types imports
    content = re.sub(r"from ['\"]\.\.+/types/express\.types['\"]", f"from '{prefix}types/express.types'", content)

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
            if fix_import_paths(str(file_path)):
                fixed_count += 1
                print(f"Fixed: {file_path.relative_to(src_dir)}")

    print(f"\nTotal files fixed: {fixed_count}")

if __name__ == "__main__":
    main()