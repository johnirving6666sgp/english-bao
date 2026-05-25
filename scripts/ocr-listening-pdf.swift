import AppKit
import Foundation
import PDFKit
import Vision

struct OCRLine: Codable {
  let text: String
  let confidence: Float
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct OCRPage: Codable {
  let page: Int
  let lines: [OCRLine]
}

let args = CommandLine.arguments
guard args.count >= 3 else {
  fputs("Usage: swift scripts/ocr-listening-pdf.swift <pdf> <output-json> [pageLimit]\n", stderr)
  exit(2)
}

let pdfURL = URL(fileURLWithPath: args[1])
let outputURL = URL(fileURLWithPath: args[2])
let pageLimit = args.count >= 4 ? Int(args[3]) : nil

guard let document = PDFDocument(url: pdfURL) else {
  fputs("Could not open PDF: \(pdfURL.path)\n", stderr)
  exit(1)
}

func renderPage(_ page: PDFPage, scale: CGFloat = 3.0) -> CGImage? {
  let box = page.bounds(for: .mediaBox)
  let width = Int(box.width * scale)
  let height = Int(box.height * scale)
  guard let context = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else {
    return nil
  }

  context.setFillColor(NSColor.white.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.saveGState()
  context.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context)
  context.restoreGState()
  return context.makeImage()
}

var pages: [OCRPage] = []
let total = min(document.pageCount, pageLimit ?? document.pageCount)

for pageIndex in 0..<total {
  guard let page = document.page(at: pageIndex), let image = renderPage(page) else {
    continue
  }

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ["en-US", "zh-Hans"]

  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try handler.perform([request])

  let lines = (request.results ?? [])
    .compactMap { observation -> OCRLine? in
      guard let candidate = observation.topCandidates(1).first else { return nil }
      let box = observation.boundingBox
      return OCRLine(
        text: candidate.string,
        confidence: candidate.confidence,
        x: box.minX,
        y: box.minY,
        width: box.width,
        height: box.height
      )
    }
    .sorted { lhs, rhs in
      let yDiff = abs(lhs.y - rhs.y)
      if yDiff > 0.01 { return lhs.y > rhs.y }
      return lhs.x < rhs.x
    }

  pages.append(OCRPage(page: pageIndex + 1, lines: lines))
  print("OCR page \(pageIndex + 1)/\(total): \(lines.count) lines")
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
try encoder.encode(pages).write(to: outputURL)
