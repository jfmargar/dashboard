// Guarda en PNG una página vista con WebKit: las capturas de docs/images (desde la demo) y la imagen social.
//   swiftc docs/render.swift -o /tmp/render
//   /tmp/render <url> <salida.png> <ancho> <alto> [escala] [javascript] [espera en segundos]
// El JavaScript se ejecuta al cargar (por ejemplo, para pulsar una pestaña) y la foto se saca tras la espera.
// docs/capturas.sh lo usa para sacar todas de una vez.
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 5, let width = Double(args[3]), let height = Double(args[4]) else {
  FileHandle.standardError.write("Uso: render <url> <salida.png> <ancho> <alto> [escala] [javascript] [espera]\n".data(using: .utf8)!)
  exit(2)
}
let target = args[1].contains("://") ? URL(string: args[1])! : URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])
let scale = args.count > 5 ? Double(args[5]) ?? 1 : 1
let script = args.count > 6 ? args[6] : ""
let wait = args.count > 7 ? Double(args[7]) ?? 2 : 2
let size = NSSize(width: width, height: height)

final class Renderer: NSObject, WKNavigationDelegate {
  // Sin datos guardados: cada captura empieza como una visita nueva (la pestaña, la vista…).
  let web: WKWebView = {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    return WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
  }()
  var done = false

  func start() {
    web.navigationDelegate = self
    if target.isFileURL {
      web.loadFileURL(target, allowingReadAccessTo: target.deletingLastPathComponent())
    } else {
      web.load(URLRequest(url: target))
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if done { return }
    done = true
    // Fuentes web listas, luego el guion de la captura y la espera para que se pinte.
    webView.evaluateJavaScript("document.fonts.ready.then(() => true)") { _, _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
        webView.evaluateJavaScript(script.isEmpty ? "true" : script) { _, error in
          if let error { FileHandle.standardError.write("JavaScript: \(error)\n".data(using: .utf8)!) }
          DispatchQueue.main.asyncAfter(deadline: .now() + wait) { self.snapshot() }
        }
      }
    }
  }

  func snapshot() {
    let config = WKSnapshotConfiguration()
    config.rect = NSRect(origin: .zero, size: size)
    config.snapshotWidth = NSNumber(value: Double(size.width) * scale)
    web.takeSnapshot(with: config) { image, error in
      guard let image, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write("No se pudo capturar: \(String(describing: error))\n".data(using: .utf8)!)
        exit(1)
      }
      let bitmap = NSBitmapImageRep(cgImage: cg)
      guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
      try! png.write(to: output)
      print("Guardada \(output.path) (\(bitmap.pixelsWide)×\(bitmap.pixelsHigh))")
      exit(0)
    }
  }
}

let app = NSApplication.shared
let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
let renderer = Renderer()
window.contentView = renderer.web
renderer.start()
DispatchQueue.main.asyncAfter(deadline: .now() + 40) { print("Tiempo agotado"); exit(1) }
app.run()
