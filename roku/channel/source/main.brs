' Nightscape screensaver.
'
' Roku does not allow video playback inside a screensaver (no Video node, no
' roVideoPlayer). This channel draws a looping sequence of JPEG frames instead.
' The frames are hosted at a URL (compiled in with FRAMES_URL, or saved here in
' the registry). Until that URL loads, the screen stays on the bundled still,
' over the night-sky background colour.

sub RunScreenSaver()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.setMessagePort(port)
    scene = screen.CreateScene("NightscapeScreen")
    size = UiSize()
    scene.viewWidth = size.w
    scene.viewHeight = size.h

    url = EffectiveUrl()
    playlist = invalid
    if url <> "" then playlist = LoadPlaylist(url)
    interval = 0
    if playlist <> invalid then
        scene.baseUrl = url
        scene.fps = playlist.fps
        scene.frameCount = playlist.count
        scene.frameWidth = playlist.width
        scene.frameHeight = playlist.height
        scene.message = ""
        scene.playback = true
        interval = Int(1000 / playlist.fps)
        if interval < 40 then interval = 40
    else
        scene.playback = false
        if url = "" then
            scene.message = "Set a frames URL in screensaver settings."
        else
            scene.message = "Could not load playlist.json from the frames URL."
        end if
    end if

    screen.show()
    tick = 0
    while true
        msg = wait(interval, port)
        if msg = invalid then
            if interval > 0 then
                tick = tick + 1
                scene.advance = tick
            end if
        else if type(msg) = "roSGScreenEvent" then
            if msg.isScreenClosed() then exit while
        end if
    end while
end sub

sub RunScreenSaverSettings()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.setMessagePort(port)
    scene = screen.CreateScene("NightscapeSettings")
    size = UiSize()
    scene.viewWidth = size.w
    scene.viewHeight = size.h
    scene.currentUrl = SavedFramesUrl()
    scene.builtInUrl = BuiltInFramesUrl()
    scene.observeField("done", port)
    screen.show()

    while true
        msg = wait(0, port)
        if type(msg) = "roSGScreenEvent" then
            if msg.isScreenClosed() then exit while
        else if type(msg) = "roSGNodeEvent" then
            if msg.getField() = "done" and msg.getData() = true then exit while
        end if
    end while

    if scene.action = "save" then
        typed = scene.typedUrl
        if typed = invalid then typed = ""
        WriteFramesUrl(typed.Trim())
    else if scene.action = "clear" then
        WriteFramesUrl("")
    end if
    screen.close()
end sub

function UiSize() as object
    w = 1280
    h = 720
    info = CreateObject("roDeviceInfo")
    if info <> invalid then
        res = info.GetUIResolution()
        if res <> invalid and res.width <> invalid and res.width > 0 then
            w = res.width
            h = res.height
        end if
    end if
    return { w: w, h: h }
end function

function Registry() as object
    return CreateObject("roRegistrySection", "Nightscape")
end function

function SavedFramesUrl() as string
    sec = Registry()
    if sec <> invalid and sec.Exists("framesUrl") then return sec.Read("framesUrl")
    return ""
end function

function WriteFramesUrl(url as string) as void
    sec = Registry()
    if sec = invalid then return
    sec.Write("framesUrl", url)
    sec.Flush()
end function

function EffectiveUrl() as string
    saved = SavedFramesUrl()
    if saved <> "" then return saved
    return BuiltInFramesUrl()
end function

function JoinUrl(base as string, leaf as string) as string
    if base = "" then return leaf
    if right(base, 1) = "/" then return base + leaf
    return base + "/" + leaf
end function

function HttpGet(url as string) as string
    xfer = CreateObject("roUrlTransfer")
    if xfer = invalid then return ""
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.InitClientCertificates()
    xfer.SetUrl(url)
    xfer.EnableEncodings(true)
    body = xfer.GetToString()
    if body = invalid then return ""
    return body
end function

function LoadPlaylist(base as string) as object
    if base = "" then return invalid
    text = ""
    path = JoinUrl(base, "playlist.json")
    if left(base, 5) = "pkg:/" then
        file = ReadAsciiFile(path)
        if file = invalid then return invalid
        text = file
    else
        text = HttpGet(path)
    end if
    if text = "" then return invalid
    data = ParseJson(text)
    if data = invalid or data.count = invalid then return invalid
    count = Int(data.count)
    if count < 1 then return invalid
    fps = 8.0
    if data.fps <> invalid and data.fps > 0 then fps = data.fps
    width = 1280
    height = 720
    if data.width <> invalid and Int(data.width) > 0 then width = Int(data.width)
    if data.height <> invalid and Int(data.height) > 0 then height = Int(data.height)
    return { count: count, fps: fps, width: width, height: height }
end function
