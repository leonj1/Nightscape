sub init()
    m.bg = m.top.findNode("bg")
    m.fallback = m.top.findNode("fallback")
    m.a = m.top.findNode("frameA")
    m.b = m.top.findNode("frameB")
    m.note = m.top.findNode("note")
    m.a.observeField("loadStatus", "onStatus")
    m.b.observeField("loadStatus", "onStatus")
    m.front = m.a
    m.back = m.b
    m.pendingNode = invalid
    m.pendingIndex = 0
    m.shown = -1
    m.fails = 0
    m.started = false
    m.booted = false
    m.backReady = false
    m.top.backgroundColor = "0x04070F"
    m.top.backgroundUri = ""
    onLayout()
end sub

sub onLayout()
    if m.bg = invalid then return
    w = m.top.viewWidth
    h = m.top.viewHeight
    if w < 100 then w = 1280
    if h < 100 then h = 720
    m.bg.width = w
    m.bg.height = h
    m.fallback.width = w
    m.fallback.height = h
    m.a.width = w
    m.a.height = h
    m.b.width = w
    m.b.height = h
    margin = int(w * 0.08)
    m.note.translation = [margin, int(h * 0.78)]
    m.note.width = w - margin * 2
    m.note.height = int(h * 0.16)
    if h >= 1080 then
        m.note.font = "font:MediumSystemFont"
    else
        m.note.font = "font:SmallSystemFont"
    end if
end sub

sub onMessage()
    if m.note = invalid then return
    m.note.text = m.top.message
    m.note.visible = m.top.message <> ""
end sub

sub onPlayback()
    if m.top.playback <> true or m.booted = true then return
    if m.top.frameCount < 1 or m.top.baseUrl = "" then return
    m.booted = true
    m.note.visible = false
    if m.top.frameWidth > 0 then
        m.a.loadWidth = m.top.frameWidth
        m.b.loadWidth = m.top.frameWidth
    end if
    if m.top.frameHeight > 0 then
        m.a.loadHeight = m.top.frameHeight
        m.b.loadHeight = m.top.frameHeight
    end if
    m.pendingNode = m.a
    m.pendingIndex = 0
    m.a.opacity = 0
    m.b.opacity = 0
    m.a.uri = FrameUrl(0)
end sub

sub onStatus(event as object)
    node = event.getRoSGNode()
    if node = invalid or node <> m.pendingNode then return
    status = event.getData()
    if status = invalid then status = node.loadStatus
    if status = "none" or status = "loading" then return
    if status = "failed" then
        m.fails = m.fails + 1
        if m.fails >= 8 then
            GiveUp()
            return
        end if
        m.pendingIndex = m.pendingIndex + 1
        if m.pendingIndex >= m.top.frameCount then m.pendingIndex = 0
        node.uri = FrameUrl(m.pendingIndex)
        return
    end if
    if status <> "ready" then return
    m.fails = 0
    if m.started <> true then
        m.started = true
        m.shown = m.pendingIndex
        node.opacity = 1
        m.fallback.visible = false
        m.front = node
        if node = m.a then m.back = m.b else m.back = m.a
        QueueNext()
        return
    end if
    m.backReady = true
end sub

sub onTick()
    if m.started <> true or m.backReady <> true then return
    m.back.opacity = 1
    m.front.opacity = 0
    m.shown = m.pendingIndex
    m.backReady = false
    held = m.front
    m.front = m.back
    m.back = held
    QueueNext()
end sub

sub QueueNext()
    if m.top.frameCount <= 1 then return
    nxt = m.shown + 1
    if nxt >= m.top.frameCount then nxt = 0
    m.pendingIndex = nxt
    m.pendingNode = m.back
    m.backReady = false
    m.back.opacity = 0
    m.back.uri = FrameUrl(nxt)
end sub

sub GiveUp()
    m.started = false
    m.backReady = false
    m.a.opacity = 0
    m.b.opacity = 0
    m.fallback.visible = true
    m.note.text = "Could not load the frames. Check the URL in screensaver settings."
    m.note.visible = true
end sub

function FrameUrl(i as integer) as string
    s = i.toStr()
    while len(s) < 5
        s = "0" + s
    end while
    base = m.top.baseUrl
    if len(base) > 0 and right(base, 1) <> "/" then base = base + "/"
    return base + "frame_" + s + ".jpg"
end function
