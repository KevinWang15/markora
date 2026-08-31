#!/usr/bin/env sh
set -eu

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
data_dir=${XDG_DATA_HOME:-"$HOME/.local/share"}
install_dir="$data_dir/markora"
applications_dir="$data_dir/applications"
icon_dir="$data_dir/icons/hicolor/scalable/apps"

mkdir -p "$install_dir" "$applications_dir" "$icon_dir"

if [ "$source_dir" != "$install_dir" ]; then
  cp -R "$source_dir/." "$install_dir/"
fi

cp "$source_dir/package.nw/icon.svg" "$icon_dir/markora.svg"
escaped_exec=$(printf '%s' "$install_dir/Markora" | sed 's/[&|\\]/\\&/g')

sed \
  -e "s|@EXEC@|$escaped_exec|g" \
  "$source_dir/package.nw/markora.desktop.template" \
  > "$applications_dir/markora.desktop"
chmod +x "$applications_dir/markora.desktop" "$install_dir/Markora"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$applications_dir" >/dev/null 2>&1 || true
fi

printf 'Markora was installed at %s\n' "$install_dir"
