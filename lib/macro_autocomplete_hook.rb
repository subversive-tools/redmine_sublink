class SublinkerHook < Redmine::Hook::ViewListener
  BASE = File.dirname(File.dirname(__FILE__))

  CSS_FILES = %w[sublink.css smart_linker.css].freeze
  JS_FILES  = %w[macro_autocomplete.js smart_linker.js].freeze

  def view_layouts_base_html_head(context = {})
    macros  = collect_macros
    css     = CSS_FILES.filter_map { |f| read_asset('stylesheets', f) }.join("\n")
    js_code = JS_FILES.filter_map  { |f| read_asset('javascripts',  f) }.join("\n")
    return '' if js_code.blank?

    formatting = Setting.text_formatting.to_s
    translations = {
      overview:    l(:label_overview),
      activity:    l(:label_activity),
      issues:      l(:label_issue_plural),
      wiki:        l(:label_wiki),
      members:     l(:label_member_plural),
      attachments: l(:label_attachment_plural),
      files:       l(:label_file_plural),
      documents:   l(:label_document_plural),
      boards:      l(:label_board_plural),
      repository:  l(:label_repository),
      calendar:    l(:label_calendar),
      gantt:       l(:label_gantt),
      news:        l(:label_news_plural),

      # Custom plugin translations
      loading_projects: l(:label_loading_projects),
      loading_error:    l(:label_loading_error),
      no_projects:      l(:label_no_projects),
      no_subpages:      l(:label_no_subpages),
      no_issues:        l(:label_no_issues),
      no_wiki:          l(:label_no_wiki),
      no_members:       l(:label_no_members),
      no_attachments:   l(:label_no_attachments),
      no_files:         l(:label_no_files),
      no_documents:     l(:label_no_documents),
      no_news:          l(:label_no_news),
      no_anchors:       l(:label_no_anchors),
      no_anchors_page:  l(:label_no_anchors_page),
      link_healed:      l(:label_link_healed)
    }

    <<~HTML.html_safe
      <style>#{css}</style>
      <script>
        window.REDMINE_MACROS = #{macros.to_json};
        window.REDMINE_FORMATTING = #{formatting.to_json};
        window.REDMINE_SUBPAGE_TRANSLATIONS = #{translations.to_json};
        #{js_code}
      </script>
    HTML
  end

  private

  def read_asset(type, filename)
    path = File.join(BASE, 'assets', type, filename)
    File.exist?(path) ? File.read(path) : nil
  end

  IMPLICIT_MACROS = [
    { name: 'toc',         desc: 'Table of contents', detail: "Renders a table of contents for the current wiki page.\nUsage: {{toc}}" },
    { name: 'child_pages', desc: 'List of child pages', detail: "Renders a list of child pages.\nUsage: {{child_pages}}" },
  ].freeze

  def collect_macros
    registered = Redmine::WikiFormatting::Macros.available_macros.map do |name, macro|
      full_desc  = (macro[:desc] || '').strip
      first_line = full_desc.split("\n").first.to_s.strip
      { name: name.to_s, desc: first_line, detail: full_desc }
    end

    existing_names = registered.map { |m| m[:name] }.to_set
    implicit = IMPLICIT_MACROS.reject { |m| existing_names.include?(m[:name]) }

    (registered + implicit).sort_by { |m| m[:name] }
  rescue => e
    Rails.logger.warn "[Sublink] SublinkerHook: could not collect macros: #{e.message}"
    []
  end
end
