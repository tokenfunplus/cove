import AppKit
import SwiftUI

struct LauncherMenuBarIcon: View {
    let bundle: Bundle

    var body: some View {
        // SwiftUI's named-image lookup can return an empty image for a SwiftPM bundle.
        if let image = bundle.image(forResource: "CoveMenuBarTemplate") {
            Image(nsImage: image)
                .renderingMode(.template)
        } else {
            Image(systemName: "water.waves")
        }
    }
}
