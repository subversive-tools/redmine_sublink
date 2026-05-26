# Plugin redmine_subtrigger
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

Redmine::Plugin.register :redmine_subtrigger do
  name        'Subtrigger'
  author      'Stefan Mischke'
  description 'Trigger autocomplete and smart linking in all Redmine wiki areas — supporting macros ({{), @-mentions, and the Smart Linker for issues, wiki pages, members, e-mail, web and attachments.'
  version     '0.5.0'
  url         'https://github.com/subversive-tools/redmine_subtrigger'
  author_url  'https://github.com/modoq'

  settings default: {
    'enable_macros' => '1',
    'enable_mentions' => '1',
    'enable_smart_linker' => '1',
    'smart_linker_trigger' => '>>'
  }, partial: 'settings/subtrigger_settings'
end

# Load the hook class — self-registers with Redmine::Hook on load
require_relative 'lib/macro_autocomplete_hook'
SubtriggerHook
