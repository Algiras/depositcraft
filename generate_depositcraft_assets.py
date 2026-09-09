#!/usr/bin/env python3
"""
Generate pixel-perfect Wix App Market assets for DepositCraft:
- App Icon: 1000x1000 square (Deposit / Security Vault / Layaway theme)
- 4 Screenshots: 1600x1200 (4:3 ratio)
"""

import os
from PIL import Image, ImageDraw, ImageFont

ASSETS_DIR = "/Users/algimantask/Personal/wix-extensions/07-deposit-layaway-checkout/depositcraft/assets"
os.makedirs(ASSETS_DIR, exist_ok=True)

def get_font(size, bold=False):
    font_paths = [
        "/System/Library/Fonts/SFPro-Bold.ttf" if bold else "/System/Library/Fonts/SFPro-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc"
    ]
    for p in font_paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

def generate_app_icon():
    print("Generating 1000x1000 app icon...")
    img = Image.new("RGB", (1000, 1000), "#0f172a")
    draw = ImageDraw.Draw(img)

    # Background gradient: Deep navy/indigo to royal purple
    for y in range(1000):
        ratio = y / 1000.0
        r = int(15 + (30 - 15) * ratio)
        g = int(23 + (27 - 23) * ratio)
        b = int(42 + (75 - 42) * ratio)
        draw.line([(0, y), (1000, y)], fill=(r, g, b))

    # Center card container
    draw.rounded_rectangle([(160, 160), (840, 840)], radius=180, fill="#1e1b4b", outline="#6366f1", width=14)

    # Inner circular vault outline
    draw.ellipse([(260, 260), (740, 740)], fill="#0f172a", outline="#38bdf8", width=12)

    # Vault outer gear notches / bolt lugs (8 bolt lugs around circumference)
    import math
    for angle in range(0, 360, 45):
        rad = math.radians(angle)
        cx = 500 + 240 * math.cos(rad)
        cy = 500 + 240 * math.sin(rad)
        draw.ellipse([(cx - 16, cy - 16), (cx + 16, cy + 16)], fill="#38bdf8")

    # Inner metallic vault dial
    draw.ellipse([(340, 340), (660, 660)], fill="#1e293b", outline="#fbbf24", width=10)

    # Central vault wheel / handle spokes
    draw.line([(500, 360), (500, 640)], fill="#ffffff", width=16)
    draw.line([(360, 500), (640, 500)], fill="#ffffff", width=16)
    draw.line([(400, 400), (600, 600)], fill="#ffffff", width=14)
    draw.line([(400, 600), (600, 400)], fill="#ffffff", width=14)

    # Central secure hub
    draw.ellipse([(440, 440), (560, 560)], fill="#0f766e", outline="#10b981", width=8)

    # Currency deposit symbol in center hub
    draw.text((472, 458), "$", fill="#ffffff", font=get_font(72, bold=True))

    # Layaway Installment Milestone Badges along bottom
    milestones = [("1", 330), ("2", 440), ("3", 550), ("4", 660)]
    for num, x in milestones:
        draw.ellipse([(x - 24, 760), (x + 24, 808)], fill="#10b981", outline="#ffffff", width=4)
        draw.text((x - 8, 766), num, fill="#ffffff", font=get_font(24, bold=True))

    img.save(os.path.join(ASSETS_DIR, "app-icon.jpg"), "JPEG", quality=95)
    print("Icon generated: app-icon.jpg")

def draw_window_frame(draw, title):
    draw.rectangle([(0, 0), (1600, 1200)], fill="#f1f5f9")
    draw.rectangle([(0, 0), (1600, 70)], fill="#0f172a")
    draw.ellipse([(30, 25), (50, 45)], fill="#ef4444")
    draw.ellipse([(65, 25), (85, 45)], fill="#f59e0b")
    draw.ellipse([(100, 25), (120, 45)], fill="#10b981")
    f_title = get_font(22, bold=True)
    draw.text((150, 22), title, fill="#f8fafc", font=f_title)
    draw.rounded_rectangle([(1420, 18), (1570, 52)], radius=8, fill="#0f766e")
    f_badge = get_font(15, bold=True)
    draw.text((1435, 26), "WIX NATIVE SPI", fill="#ffffff", font=f_badge)

def generate_screenshot_1():
    print("Generating screenshot 1: Dashboard Plans & Metrics...")
    img = Image.new("RGB", (1600, 1200), "#ffffff")
    draw = ImageDraw.Draw(img)
    draw_window_frame(draw, "Wix Business Manager — DepositCraft: Layaway & Deposit Checkout Plans")

    # Header section
    draw.text((70, 105), "Deposit & Layaway Plans", fill="#0f172a", font=get_font(32, bold=True))
    draw.text((70, 150), "Empower shoppers with split layaway installments, custom down payments, and zero DevOps overhead", fill="#64748b", font=get_font(18))
    draw.rounded_rectangle([(1330, 110), (1530, 158)], radius=8, fill="#0f766e")
    draw.text((1355, 122), "+ Create Plan", fill="#ffffff", font=get_font(18, bold=True))

    # KPI Banner Cards
    cards = [
        ("ACTIVE PLANS", "4 Configured", "Bi-weekly & Monthly", "#0f766e"),
        ("AVG DOWN PAYMENT", "25.0%", "Flexible fixed & % splits", "#6366f1"),
        ("CHECKOUT ENGINE", "100% Native", "Dual Catalog V1 & V3", "#10b981"),
        ("HOSTING COST", "$0.00 / mo", "Pure Wix serverless", "#f59e0b"),
    ]
    for i, (k, v, sub, color) in enumerate(cards):
        x = 70 + i * 370
        draw.rounded_rectangle([(x, 195), (x + 350, 305)], radius=12, fill="#ffffff", outline="#e2e8f0", width=2)
        draw.rectangle([(x, 195), (x + 8, 305)], fill=color)
        draw.text((x + 24, 215), k, fill="#64748b", font=get_font(14, bold=True))
        draw.text((x + 24, 240), v, fill="#0f172a", font=get_font(26, bold=True))
        draw.text((x + 24, 275), sub, fill=color, font=get_font(14, bold=True))

    # Plans Table Card
    draw.rounded_rectangle([(70, 335), (1530, 1140)], radius=12, fill="#ffffff", outline="#e2e8f0", width=2)
    draw.text((100, 360), "Configured Deposit & Layaway Plans", fill="#0f172a", font=get_font(22, bold=True))
    draw.text((100, 392), "Calculated instantaneously during customer checkout with sub-15ms serverless latency", fill="#64748b", font=get_font(15))
    draw.line([(70, 425), (1530, 425)], fill="#f1f5f9", width=2)

    # Table Header
    headers = [("PLAN NAME", 100), ("DEPOSIT REQUIRED", 460), ("LAYAWAY INSTALLMENTS", 710), ("MIN SPEND", 990), ("CATALOG SCOPE", 1170), ("STATUS", 1400)]
    for title, x in headers:
        draw.text((x, 440), title, fill="#64748b", font=get_font(14, bold=True))
    draw.line([(70, 470), (1530, 470)], fill="#e2e8f0", width=2)

    rows = [
        ("Luxury Furniture Layaway Plan", "25.00%", "4 x BIWEEKLY", "Min $500.00", "All Products", "ACTIVE", "#0f766e"),
        ("Custom Jewelry & Rings Deposit", "50.00%", "2 x MONTHLY", "Min $300.00", "Custom Jewelry", "ACTIVE", "#6366f1"),
        ("Consumer Electronics Reserve", "20.00%", "3 x MONTHLY", "Min $750.00", "All Products", "ACTIVE", "#0284c7"),
        ("Artisan Studio $150 Flat Deposit", "$150 Flat", "2 x BIWEEKLY", "Min $200.00", "Commissions", "ACTIVE", "#10b981"),
        ("Wedding Photography Package", "30.00%", "3 x MONTHLY", "Min $1,000.00", "Photography", "ACTIVE", "#9333ea"),
        ("Seasonal Clearance Pre-Order", "10.00%", "4 x BIWEEKLY", "Min $150.00", "All Products", "PAUSED", "#64748b"),
    ]

    for idx, (name, deposit, inst, min_spend, scope, status, col) in enumerate(rows):
        y = 490 + idx * 102
        draw.text((100, y), name, fill="#0f172a", font=get_font(17, bold=True))
        draw.text((100, y + 24), f"Plan ID: dep-{100 + idx} • Serverless SPI", fill="#94a3b8", font=get_font(13))

        draw.rounded_rectangle([(460, y), (590, y + 32)], radius=6, fill="#f8fafc", outline=col, width=1)
        draw.text((475, y + 8), deposit, fill=col, font=get_font(14, bold=True))

        draw.text((710, y + 5), inst, fill="#0f172a", font=get_font(16, bold=True))
        draw.text((990, y + 5), min_spend, fill="#334155", font=get_font(15))
        draw.text((1170, y + 5), scope, fill="#475569", font=get_font(15))

        pill_col = "#10b981" if status == "ACTIVE" else "#94a3b8"
        draw.rounded_rectangle([(1400, y), (1490, y + 32)], radius=16, fill=pill_col)
        draw.text((1418, y + 8), status, fill="#ffffff", font=get_font(12, bold=True))
        draw.line([(70, y + 78), (1530, y + 78)], fill="#f8fafc", width=2)

    img.save(os.path.join(ASSETS_DIR, "screenshot-1.jpg"), "JPEG", quality=95)
    print("Screenshot 1 generated.")

def generate_screenshot_2():
    print("Generating screenshot 2: Interactive Layaway Simulator...")
    img = Image.new("RGB", (1600, 1200), "#ffffff")
    draw = ImageDraw.Draw(img)
    draw_window_frame(draw, "Wix Business Manager — DepositCraft Live Layaway Simulator")

    draw.text((70, 105), "Live Checkout Layaway Simulator", fill="#0f172a", font=get_font(32, bold=True))
    draw.text((70, 150), "Simulate upfront deposit calculations and multi-installment schedules across checkout carts", fill="#64748b", font=get_font(18))

    # Left Container: Parameters Input
    draw.rounded_rectangle([(70, 205), (780, 1140)], radius=12, fill="#ffffff", outline="#e2e8f0", width=2)
    draw.text((105, 235), "Cart Simulation Parameters", fill="#0f172a", font=get_font(22, bold=True))
    draw.line([(70, 280), (780, 280)], fill="#f1f5f9", width=2)

    fields = [
        ("Simulated Cart Order Subtotal ($)", "1,200.00", "Exceeds $500.00 plan threshold"),
        ("Active Layaway Plan", "Luxury Furniture Layaway Plan", "25% down payment + 4 bi-weekly installments"),
        ("Product Catalog Category", "Custom Furniture (Catalog V3)", "Matches collection targeting rules"),
        ("Installment Schedule Frequency", "Bi-Weekly (Every 14 Days)", "Evenly divided automated schedule"),
    ]
    for idx, (label, val, note) in enumerate(fields):
        y = 310 + idx * 170
        draw.text((105, y), label, fill="#334155", font=get_font(16, bold=True))
        draw.rounded_rectangle([(105, y + 30), (745, y + 85)], radius=8, fill="#f8fafc", outline="#cbd5e1", width=2)
        draw.text((125, y + 46), val, fill="#0f172a", font=get_font(20, bold=True))
        draw.text((105, y + 96), f"ℹ {note}", fill="#0f766e", font=get_font(14))

    # Right Container: Simulated Wix Checkout Breakdown
    draw.rounded_rectangle([(820, 205), (1530, 1140)], radius=12, fill="#f8fafc", outline="#0f766e", width=3)
    draw.rounded_rectangle([(820, 205), (1530, 280)], radius=12, fill="#0f766e")
    draw.text((860, 230), "Wix Checkout Layaway Payment Breakdown", fill="#ffffff", font=get_font(22, bold=True))

    draw.text((860, 315), "ORDER SUMMARY", fill="#64748b", font=get_font(15, bold=True))
    draw.text((860, 350), "Total Cart Subtotal (2 items)", fill="#334155", font=get_font(18))
    draw.text((1380, 350), "$1,200.00", fill="#0f172a", font=get_font(18, bold=True))
    draw.line([(860, 385), (1490, 385)], fill="#e2e8f0", width=2)

    # Highlighted Deposit Due Now
    draw.rounded_rectangle([(860, 405), (1490, 485)], radius=8, fill="#ecfdf5", outline="#10b981", width=2)
    draw.text((885, 422), "DEPOSIT DUE TODAY (AT CHECKOUT)", fill="#047857", font=get_font(15, bold=True))
    draw.text((885, 448), "25.00% Down Payment to reserve order", fill="#065f46", font=get_font(14))
    draw.text((1370, 428), "$300.00", fill="#047857", font=get_font(26, bold=True))

    # Deferred Balance
    draw.text((860, 515), "Deferred Layaway Balance", fill="#64748b", font=get_font(17))
    draw.text((1400, 515), "$900.00", fill="#0f172a", font=get_font(18, bold=True))
    draw.line([(860, 545), (1490, 545)], fill="#e2e8f0", width=2)

    draw.text((860, 565), "SCHEDULED INSTALLMENTS (4 BI-WEEKLY PAYMENTS)", fill="#0f766e", font=get_font(15, bold=True))

    installments = [
        ("Installment #1", "Due in 2 weeks (Auto-draft)", "$225.00"),
        ("Installment #2", "Due in 4 weeks (Auto-draft)", "$225.00"),
        ("Installment #3", "Due in 6 weeks (Auto-draft)", "$225.00"),
        ("Installment #4 (Final)", "Due in 8 weeks (Fulfillment Release)", "$225.00"),
    ]
    for idx, (inst_title, inst_due, inst_amt) in enumerate(installments):
        iy = 600 + idx * 75
        draw.rounded_rectangle([(860, iy), (1490, iy + 62)], radius=8, fill="#ffffff", outline="#e2e8f0", width=1)
        draw.text((880, iy + 12), inst_title, fill="#0f172a", font=get_font(16, bold=True))
        draw.text((880, iy + 36), inst_due, fill="#64748b", font=get_font(13))
        draw.text((1400, iy + 18), inst_amt, fill="#0f766e", font=get_font(18, bold=True))

    # Total checkout footer card
    draw.rounded_rectangle([(860, 930), (1490, 1010)], radius=10, fill="#0f172a")
    draw.text((890, 955), "TOTAL ORDER VALUE LOCKED", fill="#ffffff", font=get_font(18, bold=True))
    draw.text((1350, 948), "$1,200.00", fill="#38bdf8", font=get_font(26, bold=True))

    draw.text((860, 1045), "⚡ Engine Latency: 11ms (Wix Serverless)", fill="#0284c7", font=get_font(15, bold=True))
    draw.text((860, 1075), "🛡 Dual Catalog V1 & V3 Payload Compatible", fill="#10b981", font=get_font(15, bold=True))

    img.save(os.path.join(ASSETS_DIR, "screenshot-2.jpg"), "JPEG", quality=95)
    print("Screenshot 2 generated.")

def generate_screenshot_3():
    print("Generating screenshot 3: Plan Configuration Modal...")
    img = Image.new("RGB", (1600, 1200), "#ffffff")
    draw = ImageDraw.Draw(img)
    draw_window_frame(draw, "Wix Business Manager — Create Deposit & Layaway Plan")

    # Darkened backdrop
    draw.rectangle([(0, 70), (1600, 1200)], fill="#0f172a99")

    # Centered Modal
    draw.rounded_rectangle([(360, 180), (1240, 1100)], radius=16, fill="#ffffff")
    draw.text((410, 220), "Create Deposit & Layaway Plan", fill="#0f172a", font=get_font(26, bold=True))
    draw.text((410, 260), "Configure required down payment, installment intervals, and minimum spend rules", fill="#64748b", font=get_font(16))
    draw.line([(360, 300), (1240, 300)], fill="#e2e8f0", width=2)

    form_items = [
        ("Plan Display Name", "Bespoke Custom Furniture Layaway", "Appears directly on Wix checkout payment step"),
        ("Deposit Calculation Structure", "Percentage Down Payment (25%)", "Supports Percentage or Fixed Amount"),
        ("Layaway Installments Count", "4 Installments (Bi-weekly interval)", "Automatically calculates equal payment schedule"),
        ("Minimum Order Spend Threshold ($)", "500.00", "Layaway option only displays for orders $500+"),
        ("Target Catalog Scope", "Collection Targeting: custom-furniture, dining-sets", "Restricts layaway to high-ticket collections"),
    ]

    for idx, (label, val, hint) in enumerate(form_items):
        y = 330 + idx * 130
        draw.text((410, y), label, fill="#334155", font=get_font(16, bold=True))
        draw.rounded_rectangle([(410, y + 26), (1190, y + 76)], radius=8, fill="#f8fafc", outline="#cbd5e1", width=2)
        draw.text((430, y + 40), val, fill="#0f172a", font=get_font(17, bold=True))
        draw.text((410, y + 84), hint, fill="#64748b", font=get_font(13))

    # Modal Footer
    draw.line([(360, 990), (1240, 990)], fill="#e2e8f0", width=2)
    draw.rounded_rectangle([(880, 1015), (1020, 1065)], radius=8, fill="#ffffff", outline="#cbd5e1", width=2)
    draw.text((920, 1030), "Cancel", fill="#475569", font=get_font(16, bold=True))
    draw.rounded_rectangle([(1040, 1015), (1200, 1065)], radius=8, fill="#0f766e")
    draw.text((1075, 1030), "Save Plan", fill="#ffffff", font=get_font(16, bold=True))

    img.save(os.path.join(ASSETS_DIR, "screenshot-3.jpg"), "JPEG", quality=95)
    print("Screenshot 3 generated.")

def generate_screenshot_4():
    print("Generating screenshot 4: Storefront Wix Checkout Experience...")
    img = Image.new("RGB", (1600, 1200), "#ffffff")
    draw = ImageDraw.Draw(img)
    draw_window_frame(draw, "Customer Storefront Checkout — Native Layaway & Split Payment")

    # Storefront header
    draw.rectangle([(70, 100), (1530, 170)], fill="#ffffff")
    draw.text((100, 120), "Nordic Handcrafted Living & Furniture", fill="#0f172a", font=get_font(26, bold=True))
    draw.text((1350, 128), "🔒 Secure Checkout", fill="#10b981", font=get_font(16, bold=True))
    draw.line([(70, 175), (1530, 175)], fill="#e2e8f0", width=2)

    # Left: Checkout Steps
    draw.rounded_rectangle([(70, 205), (940, 1140)], radius=12, fill="#ffffff", outline="#e2e8f0", width=2)
    draw.text((105, 235), "1. Delivery Information", fill="#0f172a", font=get_font(20, bold=True))
    draw.text((105, 275), "Shipping Address: 742 Evergreen Terrace, Portland, OR 97201", fill="#475569", font=get_font(16))
    draw.line([(105, 315), (905, 315)], fill="#f1f5f9", width=2)

    draw.text((105, 345), "2. Payment Method", fill="#0f172a", font=get_font(20, bold=True))

    # Selected Layaway Option Box
    draw.rounded_rectangle([(105, 385), (905, 535)], radius=10, fill="#f0fdf4", outline="#10b981", width=2)
    draw.ellipse([(135, 415), (155, 435)], fill="#10b981")
    draw.text((175, 412), "DepositCraft Layaway — Pay $300.00 today", fill="#065f46", font=get_font(18, bold=True))
    draw.text((175, 442), "Lock in order with 25% down. Remaining $900.00 split into 4 bi-weekly payments of $225.00.", fill="#334155", font=get_font(14))
    draw.text((175, 472), "✓ 0% Interest • No hard credit check • Auto-scheduled receipts", fill="#047857", font=get_font(14, bold=True))

    # Standard Credit Card unselected
    draw.rounded_rectangle([(105, 555), (905, 625)], radius=10, fill="#ffffff", outline="#cbd5e1", width=1)
    draw.ellipse([(135, 580), (155, 600)], fill="#ffffff", outline="#94a3b8", width=2)
    draw.text((175, 578), "Credit / Debit Card (Pay Full $1,200.00)", fill="#475569", font=get_font(16))

    draw.line([(105, 660), (905, 660)], fill="#f1f5f9", width=2)
    draw.text((105, 690), "3. Layaway Agreement & Terms", fill="#0f172a", font=get_font(20, bold=True))
    draw.text((105, 725), "☑ I agree to the scheduled automated installment debits and fulfillment terms.", fill="#334155", font=get_font(15))

    # Right: Order Summary with highlighted DepositCraft Line items
    draw.rounded_rectangle([(970, 205), (1530, 1140)], radius=12, fill="#f8fafc", outline="#cbd5e1", width=2)
    draw.text((1005, 235), "Order Summary (2 items)", fill="#0f172a", font=get_font(22, bold=True))
    draw.line([(970, 275), (1530, 275)], fill="#e2e8f0", width=2)

    # Cart item 1
    draw.text((1005, 305), "Solid Oak Dining Table (Catalog V3)", fill="#0f172a", font=get_font(16, bold=True))
    draw.text((1005, 330), "Qty: 1 • Natural Matte Finish", fill="#64748b", font=get_font(14))
    draw.text((1415, 315), "$950.00", fill="#0f172a", font=get_font(17, bold=True))

    # Cart item 2
    draw.text((1005, 380), "Pair of Handcrafted Dining Chairs", fill="#0f172a", font=get_font(16, bold=True))
    draw.text((1005, 405), "Qty: 1 • Slate Fabric", fill="#64748b", font=get_font(14))
    draw.text((1415, 390), "$250.00", fill="#0f172a", font=get_font(17, bold=True))

    draw.line([(1005, 450), (1495, 450)], fill="#e2e8f0", width=2)

    draw.text((1005, 475), "Full Order Value", fill="#334155", font=get_font(16))
    draw.text((1405, 475), "$1,200.00", fill="#0f172a", font=get_font(16, bold=True))

    draw.text((1005, 510), "Standard Freight Delivery", fill="#334155", font=get_font(16))
    draw.text((1440, 510), "FREE", fill="#10b981", font=get_font(16, bold=True))

    # Highlighted Layaway Split Details Box
    draw.rounded_rectangle([(995, 550), (1505, 700)], radius=8, fill="#ecfdf5", outline="#10b981", width=2)
    draw.text((1015, 565), "⚡ DepositCraft Active Layaway Plan:", fill="#047857", font=get_font(15, bold=True))

    draw.text((1015, 600), "Initial Deposit (Due Today)", fill="#0f172a", font=get_font(16, bold=True))
    draw.text((1420, 600), "$300.00", fill="#0f766e", font=get_font(18, bold=True))

    draw.text((1015, 640), "Remaining Balance (4 x $225.00)", fill="#475569", font=get_font(15))
    draw.text((1420, 640), "$900.00", fill="#64748b", font=get_font(16, bold=True))

    draw.text((1005, 725), "Estimated Sales Tax", fill="#334155", font=get_font(16))
    draw.text((1435, 725), "$24.00", fill="#0f172a", font=get_font(16, bold=True))

    draw.line([(1005, 765), (1495, 765)], fill="#e2e8f0", width=2)

    draw.text((1005, 795), "TOTAL DUE TODAY", fill="#0f172a", font=get_font(22, bold=True))
    draw.text((1380, 790), "$324.00", fill="#0f766e", font=get_font(28, bold=True))

    draw.rounded_rectangle([(1005, 850), (1495, 915)], radius=10, fill="#0f766e")
    draw.text((1160, 870), "Confirm Deposit Order", fill="#ffffff", font=get_font(20, bold=True))

    img.save(os.path.join(ASSETS_DIR, "screenshot-4.jpg"), "JPEG", quality=95)
    print("Screenshot 4 generated.")

if __name__ == "__main__":
    generate_app_icon()
    generate_screenshot_1()
    generate_screenshot_2()
    generate_screenshot_3()
    generate_screenshot_4()
    print("All DepositCraft assets successfully generated!")
