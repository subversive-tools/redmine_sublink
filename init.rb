# Plugin redmine_sublink
# Provides smart linking and wiki macro autocomplete in all Redmine wiki text areas.
#
# Features:
#   {{ — Makro-Autocomplete (mit Beschreibung und Detail-Panel)
#   @  — Sofort-Dropdown ab erstem Zeichen (max. 10 Einträge)
#   >> — Smart Linker: Projekt → Issues | Mitglieder | Wiki | E-Mail | Weblink | Anhang
#
# init.rb is executed by Redmine::PluginLoader INSIDE its own to_prepare block,
# so we apply hooks directly here — no nested Rails.configuration.to_prepare needed.

require 'redmine'

Redmine::Plugin.register :redmine_sublink do
  name        'Sublink'
  author      'Stefan Mischke'
  description 'Smart linking and autocomplete for Redmine — macros ({{), @-mentions, and the >> Smart Linker for issues, wiki pages, members, e-mail, web and attachments.'
  version     '0.2.0'
  url         'https://github.com/subversive-tools/redmine_sublink'
  author_url  'https://github.com/modoq'
end

# Load the hook class — self-registers with Redmine::Hook on load
SublinkerHook
