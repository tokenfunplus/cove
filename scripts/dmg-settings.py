"""Finder layout for Cove's drag-to-install disk image."""

format = "UDZO"
filesystem = "HFS+"
files = [defines["app"]]
symlinks = {"Applications": "/Applications"}
background = defines["background"]
window_rect = ((180, 140), (720, 440))
default_view = "icon-view"
icon_size = 112
text_size = 14
icon_locations = {"Cove.app": (180, 218), "Applications": (540, 218)}
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
include_icon_view_settings = True
include_list_view_settings = False
