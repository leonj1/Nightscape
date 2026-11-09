sub init()
    m.bg = m.top.findNode("bg")
    m.hero = m.top.findNode("hero")
    m.dim = m.top.findNode("dim")
    m.title = m.top.findNode("title")
    m.help = m.top.findNode("help")
    m.builtin = m.top.findNode("builtin")
    m.box = m.top.findNode("box")
    m.save = m.top.findNode("save")
    m.clear = m.top.findNode("clear")
    m.help.text = "Roku screensavers cannot play video, so Nightscape shows a folder of frames. Enter the folder URL (the one that contains playlist.json). Save stores it on this TV. An empty save, or Clear, uses the URL built into the channel."
    m.save.observeField("buttonSelected", "onSave")
    m.clear.observeField("buttonSelected", "onClear")
    m.focus = 0
    m.top.backgroundColor = "0x04070F"
    m.top.backgroundUri = ""
    onLayout()
    applyFocus()
end sub

sub applyFocus()
    if m.focus <= 0 then
        m.box.setFocus(true)
    else if m.focus = 1 then
        m.save.setFocus(true)
    else
        m.clear.setFocus(true)
    end if
end sub

sub onLayout()
    if m.bg = invalid then return
    w = m.top.viewWidth
    h = m.top.viewHeight
    if w < 100 then w = 1280
    if h < 100 then h = 720
    m.bg.width = w
    m.bg.height = h
    m.hero.width = w
    m.hero.height = h
    m.dim.width = w
    m.dim.height = h
    margin = int(w * 0.08)
    inner = w - margin * 2
    m.title.translation = [margin, int(h * 0.10)]
    m.title.width = inner
    m.help.translation = [margin, int(h * 0.20)]
    m.help.width = inner
    m.help.height = int(h * 0.18)
    m.builtin.translation = [margin, int(h * 0.40)]
    m.builtin.width = inner
    m.builtin.height = int(h * 0.12)
    m.box.translation = [margin, int(h * 0.54)]
    m.box.width = inner
    m.box.height = int(h * 0.08)
    m.save.translation = [margin, int(h * 0.68)]
    m.clear.translation = [margin + int(inner * 0.34), int(h * 0.68)]
    m.save.minWidth = int(inner * 0.28)
    m.clear.minWidth = int(inner * 0.36)
    if h >= 1080 then
        m.title.font = "font:ExtraLargeBoldSystemFont"
        m.help.font = "font:MediumSystemFont"
        m.builtin.font = "font:SmallSystemFont"
    else
        m.title.font = "font:LargeBoldSystemFont"
        m.help.font = "font:SmallSystemFont"
        m.builtin.font = "font:SmallestSystemFont"
    end if
end sub

sub onCurrent()
    if m.box = invalid then return
    m.box.text = m.top.currentUrl
end sub

sub onBuiltIn()
    if m.builtin = invalid then return
    builtin = m.top.builtInUrl
    if builtin = "" then builtin = "(none yet — save a URL here, or rebuild the zip with FRAMES_URL)"
    m.builtin.text = "URL built into this channel: " + builtin
end sub

sub onSave()
    if m.save.buttonSelected <> true then return
    m.top.typedUrl = m.box.text
    m.top.action = "save"
    m.top.done = true
end sub

sub onClear()
    if m.clear.buttonSelected <> true then return
    m.top.action = "clear"
    m.top.done = true
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if press <> true then return false
    if key = "back" then
        m.top.action = "cancel"
        m.top.done = true
        return true
    else if key = "down" then
        if m.focus < 2 then m.focus = m.focus + 1
        applyFocus()
        return true
    else if key = "up" then
        if m.focus > 0 then m.focus = m.focus - 1
        applyFocus()
        return true
    else if key = "right" and m.focus = 1 then
        m.focus = 2
        applyFocus()
        return true
    else if key = "left" and m.focus = 2 then
        m.focus = 1
        applyFocus()
        return true
    end if
    return false
end function
