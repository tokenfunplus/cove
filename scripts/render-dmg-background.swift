import AppKit

guard CommandLine.arguments.count == 2 else {
    fatalError("Usage: render-dmg-background.swift OUTPUT_DIRECTORY")
}

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let size = NSSize(width: 720, height: 440)
let ink = NSColor(srgbRed: 0.10, green: 0.23, blue: 0.28, alpha: 1)
let secondary = NSColor(srgbRed: 0.35, green: 0.43, blue: 0.46, alpha: 1)
let teal = NSColor(srgbRed: 0.27, green: 0.64, blue: 0.60, alpha: 1)

for scale in [1, 2] {
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(size.width) * scale,
        pixelsHigh: Int(size.height) * scale, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    bitmap.size = size
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.current = context

    NSColor(srgbRed: 0.97, green: 0.985, blue: 0.98, alpha: 1).setFill()
    NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()

    func text(_ value: String, top: CGFloat, font: NSFont, color: NSColor) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        (value as NSString).draw(
            in: NSRect(x: 40, y: size.height - top - 40, width: 640, height: 40),
            withAttributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph]
        )
    }

    text("Install Cove", top: 44, font: .systemFont(ofSize: 30, weight: .semibold), color: ink)
    text("Drag Cove to Applications to get started.", top: 94,
         font: .systemFont(ofSize: 15), color: secondary)

    teal.setStroke()
    let arrow = NSBezierPath()
    arrow.lineWidth = 3
    arrow.lineCapStyle = .round
    arrow.lineJoinStyle = .round
    arrow.move(to: NSPoint(x: 326, y: 222))
    arrow.line(to: NSPoint(x: 394, y: 222))
    arrow.move(to: NSPoint(x: 383, y: 233))
    arrow.line(to: NSPoint(x: 394, y: 222))
    arrow.line(to: NSPoint(x: 383, y: 211))
    arrow.stroke()

    NSColor(srgbRed: 0.85, green: 0.90, blue: 0.88, alpha: 1).setStroke()
    let divider = NSBezierPath()
    divider.move(to: NSPoint(x: 64, y: 112))
    divider.line(to: NSPoint(x: 656, y: 112))
    divider.lineWidth = 1
    divider.stroke()
    text("Then open Cove from Applications.", top: 346,
         font: .systemFont(ofSize: 14, weight: .medium), color: ink)
    text("Look for Cove in your menu bar.", top: 372,
         font: .systemFont(ofSize: 13), color: secondary)

    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Could not encode the DMG background")
    }
    let name = scale == 1 ? "background.png" : "background@2x.png"
    try png.write(to: directory.appendingPathComponent(name))
}
