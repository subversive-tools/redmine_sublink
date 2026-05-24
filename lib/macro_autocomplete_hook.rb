class SublinkerHook < Redmine::Hook::ViewListener
  BASE = File.dirname(File.dirname(__FILE__))

  CSS_FILES = %w[sublink.css smart_linker.css].freeze
  JS_FILES  = %w[macro_autocomplete.js smart_linker.js].freeze

  def view_layouts_base_html_head(context = {})
    macros  = collect_macros
    css     = CSS_FILES.filter_map { |f| read_asset('stylesheets', f) }.join("\n")
    js_code = JS_FILES.filter_map  { |f| read_asset('javascripts',  f) }.join("\n")
    return '' if js_code.blank?

    <<~HTML.html_safe
      <style>#{css}</style>
      <script>
        window.REDMINE_MACROS = #{macros.to_json};
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
