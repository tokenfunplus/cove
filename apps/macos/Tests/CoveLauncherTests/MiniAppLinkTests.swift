import Foundation
import XCTest
@testable import CoveLauncher

final class MiniAppLinkTests: XCTestCase {
    func testValidatedDestinations() throws {
        let id = UUID()
        XCTAssertEqual(MiniAppLink(try XCTUnwrap(URL(string: "cove://open/\(id)/home"))), .open(id, "home"))
        XCTAssertEqual(MiniAppLink(try XCTUnwrap(URL(string: "cove://install/cove/review?version=1.0.0"))), .install("cove", "review", "1.0.0"))
        XCTAssertEqual(MiniAppLink(try XCTUnwrap(URL(string: "cove://install/cove/review"))), .install("cove", "review", nil))
        for text in ["cove://open/\(id)/%2Fother", "cove://install/cove/review?token=secret",
                     "https://install/cove/review", "cove://pick/\(id)?file=private", "cove://install/u/../other",
                     "cove://install/cove/review?version=1.0.0%0A"] {
            XCTAssertNil(MiniAppLink(try XCTUnwrap(URL(string: text))))
        }
    }
}
