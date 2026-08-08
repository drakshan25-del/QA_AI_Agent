"""Gold seed corpus for fine-tuning the planner and coder models.

Every training label is generated from a compact :class:`Feature` spec, so the
requirement text, analysis, test cases, test plan and Playwright code all
describe the *same* application behaviour — correct by construction. The
corpus spans 8 fictional web apps / 27 features; the ``Beacon Helpdesk`` app
is held out of training entirely and used for evaluation.

Nothing here calls an LLM and nothing is random without a fixed seed: the
whole corpus is deterministic so dataset builds are reproducible.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field as dc_field

#: Stable namespace for deterministic per-case UUIDs (mirrors DB row ids).
_NS = uuid.UUID("7c9d1f7e-4b1a-4f7e-9c9e-2f1a7b3d5e90")


def case_id(feature_key: str, case_key: str) -> str:
    return str(uuid.uuid5(_NS, f"{feature_key}:{case_key}"))


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return re.sub(r"_+", "_", slug)


def pascal(key: str) -> str:
    return "".join(part.capitalize() for part in key.split("_"))


# ---------------------------------------------------------------------------
# Spec model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FormField:
    label: str
    attr: str
    kind: str = "text"  # text|email|password|number|select|textarea|checkbox|file|date
    required: bool = True
    error_required: str = ""
    error_invalid: str = ""
    invalid_example: str = ""
    valid_example: str = ""
    min_value: int | None = None
    max_value: int | None = None
    max_len: int | None = None
    options: tuple[str, ...] = ()
    secret_env: str = ""        # test_data refers to this env var name, never a value
    from_credentials: str = ""  # "username"|"password" -> code uses the credentials fixture


@dataclass(frozen=True)
class Feature:
    key: str
    app: str
    base_url: str
    req_id: str
    name: str
    actor: str
    benefit: str
    path: str
    heading: str
    submit_label: str
    success_kind: str  # message|redirect|results
    success_text: str
    success_path: str = ""
    fields: tuple[FormField, ...] = ()
    roles: tuple[str, ...] = ()
    role_error: str = ""
    duplicate_error: str = ""
    server_error: str = ""
    security_error: str = ""
    precondition: str = ""
    results_terms: tuple[str, str] = ("", "")   # (matching term, gibberish term)
    empty_results_text: str = ""
    holdout: bool = False


# ---------------------------------------------------------------------------
# Corpus
# ---------------------------------------------------------------------------


def _f(**kw) -> FormField:
    return FormField(**kw)


FEATURES: tuple[Feature, ...] = (
    # ----- Aurora Shop (e-commerce) ---------------------------------------
    Feature(
        key="shop_login", app="Aurora Shop", base_url="http://localhost:8001",
        req_id="REQ-1", name="Customer sign in", actor="returning customer",
        benefit="I can access my orders and saved basket",
        path="/signin", heading="Sign in to Aurora Shop", submit_label="Sign in",
        success_kind="redirect", success_text="Your account", success_path="/account",
        precondition="A customer account exists (seeded test account)",
        fields=(
            _f(label="Email", attr="email", kind="email",
               error_required="Enter your email address.",
               error_invalid="Enter a valid email address.",
               invalid_example="mia.at-example", valid_example="mia@example.com",
               from_credentials="username"),
            _f(label="Password", attr="password", kind="password",
               error_required="Enter your password.",
               secret_env="QA_TEST_PASSWORD", from_credentials="password"),
        ),
        server_error="We could not sign you in right now. Please try again.",
        security_error="Enter a valid email address.",
    ),
    Feature(
        key="shop_registration", app="Aurora Shop", base_url="http://localhost:8001",
        req_id="REQ-2", name="Customer registration", actor="new visitor",
        benefit="I can create an account and check out faster",
        path="/register", heading="Create your account", submit_label="Create account",
        success_kind="message", success_text="Welcome to Aurora Shop! Your account is ready.",
        fields=(
            _f(label="Full name", attr="full_name",
               error_required="Enter your full name.", valid_example="Mia Chen"),
            _f(label="Email", attr="email", kind="email",
               error_required="Enter your email address.",
               error_invalid="Enter a valid email address.",
               invalid_example="mia#example.com", valid_example="mia@example.com"),
            _f(label="Password", attr="password", kind="password",
               error_required="Choose a password.",
               error_invalid="Password must be at least 10 characters.",
               invalid_example="short1", secret_env="QA_TEST_PASSWORD"),
            _f(label="I accept the terms and conditions", attr="terms", kind="checkbox",
               error_required="You must accept the terms to register."),
        ),
        duplicate_error="An account with this email already exists.",
    ),
    Feature(
        key="product_search", app="Aurora Shop", base_url="http://localhost:8001",
        req_id="REQ-3", name="Product search", actor="shopper",
        benefit="I can find products by name quickly",
        path="/search", heading="Search products", submit_label="Search",
        success_kind="results", success_text="Matching products are listed",
        results_terms=("ceramic mug", "zzqxv"),
        empty_results_text="No products matched your search.",
        fields=(
            _f(label="Search products", attr="query",
               error_required="Type something to search for.",
               valid_example="ceramic mug", max_len=100),
        ),
    ),
    Feature(
        key="coupon_code", app="Aurora Shop", base_url="http://localhost:8001",
        req_id="REQ-4", name="Coupon redemption at checkout", actor="shopper with a basket",
        benefit="my discount is applied before payment",
        path="/checkout/coupon", heading="Apply a coupon", submit_label="Apply coupon",
        success_kind="message", success_text="Coupon applied: 10% off your order.",
        precondition="The basket contains at least one item",
        fields=(
            _f(label="Coupon code", attr="code",
               error_required="Enter a coupon code.",
               error_invalid="This coupon code is not valid.",
               invalid_example="NOTACODE", valid_example="SAVE10"),
        ),
        server_error="Coupons are temporarily unavailable. Try again shortly.",
    ),
    Feature(
        key="checkout_address", app="Aurora Shop", base_url="http://localhost:8001",
        req_id="REQ-5", name="Delivery address entry", actor="shopper checking out",
        benefit="my order is delivered to the right place",
        path="/checkout/address", heading="Delivery address", submit_label="Continue to payment",
        success_kind="redirect", success_text="Payment", success_path="/checkout/payment",
        precondition="The basket contains at least one item",
        fields=(
            _f(label="Recipient name", attr="recipient",
               error_required="Enter the recipient's name.", valid_example="Mia Chen"),
            _f(label="Street address", attr="street",
               error_required="Enter a street address.", valid_example="12 Harbour Lane"),
            _f(label="City", attr="city",
               error_required="Enter a city.", valid_example="Wellington"),
            _f(label="Postal code", attr="postal_code",
               error_required="Enter a postal code.",
               error_invalid="Postal code must be 4 to 10 characters.",
               invalid_example="12", valid_example="6011"),
            _f(label="Country", attr="country", kind="select",
               error_required="Select a country.",
               options=("New Zealand", "Australia", "Singapore"),
               valid_example="New Zealand"),
        ),
    ),
    # ----- Lumen CRM -------------------------------------------------------
    Feature(
        key="lead_create", app="Lumen CRM", base_url="http://localhost:8002",
        req_id="REQ-6", name="Lead creation", actor="sales representative",
        benefit="new prospects are tracked in the pipeline",
        path="/leads/new", heading="New lead", submit_label="Save lead",
        success_kind="message", success_text="Lead saved.",
        precondition="User is signed in as a sales representative",
        fields=(
            _f(label="Company", attr="company",
               error_required="Company is required.", valid_example="Kereru Systems"),
            _f(label="Contact name", attr="contact_name",
               error_required="Contact name is required.", valid_example="Tane Ruru"),
            _f(label="Work email", attr="work_email", kind="email",
               error_required="Work email is required.",
               error_invalid="Work email must be a valid email address.",
               invalid_example="tane[at]kereru.nz", valid_example="tane@kereru.nz"),
            _f(label="Lead source", attr="source", kind="select",
               error_required="Choose a lead source.",
               options=("Referral", "Webinar", "Cold outreach", "Website"),
               valid_example="Webinar"),
        ),
        duplicate_error="A lead with this work email already exists.",
    ),
    Feature(
        key="contact_note", app="Lumen CRM", base_url="http://localhost:8002",
        req_id="REQ-7", name="Contact activity note", actor="account manager",
        benefit="calls and meetings are recorded against the contact",
        path="/contacts/41/notes", heading="Add a note", submit_label="Save note",
        success_kind="message", success_text="Note added to the contact timeline.",
        precondition="User is signed in and a contact record exists",
        fields=(
            _f(label="Note", attr="note", kind="textarea",
               error_required="Write a note before saving.",
               error_invalid="Notes are limited to 2000 characters.",
               max_len=2000, valid_example="Call summary: renewal agreed for Q3."),
        ),
        security_error="Notes may not contain script tags.",
    ),
    Feature(
        key="deal_amount_update", app="Lumen CRM", base_url="http://localhost:8002",
        req_id="REQ-8", name="Deal stage and amount update", actor="sales representative",
        benefit="forecasts reflect the real pipeline",
        path="/deals/17/edit", heading="Edit deal", submit_label="Update deal",
        success_kind="message", success_text="Deal updated.",
        precondition="User is signed in and owns the deal",
        fields=(
            _f(label="Stage", attr="stage", kind="select",
               error_required="Select a stage.",
               options=("Qualified", "Proposal", "Negotiation", "Closed won"),
               valid_example="Proposal"),
            _f(label="Amount", attr="amount", kind="number",
               error_required="Enter the deal amount.",
               error_invalid="Amount must be between 1 and 1000000.",
               min_value=1, max_value=1000000, valid_example="25000",
               invalid_example="0"),
        ),
    ),
    Feature(
        key="team_invite", app="Lumen CRM", base_url="http://localhost:8002",
        req_id="REQ-9", name="Team member invitation", actor="workspace admin",
        benefit="colleagues can join the workspace with the right role",
        path="/settings/team/invite", heading="Invite a teammate", submit_label="Send invite",
        success_kind="message", success_text="Invitation sent.",
        precondition="User is signed in as a workspace admin",
        roles=("admin", "member"), role_error="Only admins can invite teammates.",
        fields=(
            _f(label="Email", attr="email", kind="email",
               error_required="Enter the teammate's email.",
               error_invalid="Enter a valid email address.",
               invalid_example="ana@", valid_example="ana@lumen.example"),
            _f(label="Role", attr="role", kind="select",
               error_required="Choose a role for the teammate.",
               options=("Admin", "Member", "Read-only"), valid_example="Member"),
        ),
        duplicate_error="This person has already been invited.",
    ),
    # ----- Pulse Fitness ---------------------------------------------------
    Feature(
        key="class_booking", app="Pulse Fitness", base_url="http://localhost:8003",
        req_id="REQ-10", name="Fitness class booking", actor="gym member",
        benefit="I can reserve a spot before classes fill up",
        path="/classes/book", heading="Book a class", submit_label="Book now",
        success_kind="message", success_text="You're booked! A confirmation email is on its way.",
        precondition="User is signed in with an active membership",
        fields=(
            _f(label="Class", attr="class_name", kind="select",
               error_required="Choose a class.",
               options=("Yoga Flow", "HIIT 45", "Spin Express", "Pilates Core"),
               valid_example="HIIT 45"),
            _f(label="Date", attr="date", kind="date",
               error_required="Pick a date.",
               error_invalid="Bookings must be for a future date.",
               invalid_example="2020-01-01", valid_example="2026-09-15"),
            _f(label="Participants", attr="participants", kind="number",
               error_required="Enter the number of participants.",
               error_invalid="Participants must be between 1 and 4.",
               min_value=1, max_value=4, valid_example="2", invalid_example="0"),
        ),
        server_error="Booking could not be completed. No payment was taken.",
    ),
    Feature(
        key="membership_upgrade", app="Pulse Fitness", base_url="http://localhost:8003",
        req_id="REQ-11", name="Membership plan upgrade", actor="gym member",
        benefit="I can move to a plan that fits my training",
        path="/membership/upgrade", heading="Upgrade your plan", submit_label="Upgrade",
        success_kind="redirect", success_text="Plan summary", success_path="/membership/summary",
        precondition="User is signed in with a Basic plan",
        fields=(
            _f(label="New plan", attr="plan", kind="select",
               error_required="Select the plan to upgrade to.",
               options=("Plus", "Pro", "Family"), valid_example="Pro"),
            _f(label="Promo code", attr="promo", required=False,
               error_invalid="This promo code has expired.",
               invalid_example="OLDPROMO", valid_example="SPRING24"),
        ),
    ),
    Feature(
        key="trainer_feedback", app="Pulse Fitness", base_url="http://localhost:8003",
        req_id="REQ-12", name="Trainer session feedback", actor="gym member",
        benefit="trainers get actionable feedback after sessions",
        path="/sessions/88/feedback", heading="Rate your session", submit_label="Submit feedback",
        success_kind="message", success_text="Thanks for your feedback!",
        precondition="User is signed in and attended the session",
        fields=(
            _f(label="Rating", attr="rating", kind="number",
               error_required="Choose a rating.",
               error_invalid="Rating must be between 1 and 5.",
               min_value=1, max_value=5, valid_example="4", invalid_example="6"),
            _f(label="Comments", attr="comments", kind="textarea", required=False,
               error_invalid="Comments are limited to 500 characters.",
               max_len=500, valid_example="Great pacing and clear instructions."),
        ),
    ),
    # ----- Nova Bank -------------------------------------------------------
    Feature(
        key="fund_transfer", app="Nova Bank", base_url="http://localhost:8004",
        req_id="REQ-13", name="Domestic fund transfer", actor="account holder",
        benefit="I can move money to another account securely",
        path="/transfers/new", heading="Transfer money", submit_label="Review transfer",
        success_kind="redirect", success_text="Confirm transfer", success_path="/transfers/confirm",
        precondition="User is signed in and has a funded account",
        fields=(
            _f(label="Recipient account number", attr="recipient_account",
               error_required="Enter the recipient's account number.",
               error_invalid="Account number must be 8 to 12 digits.",
               invalid_example="12AB", valid_example="004512789034"),
            _f(label="Amount", attr="amount", kind="number",
               error_required="Enter an amount.",
               error_invalid="Amount must be between 1 and 20000.",
               min_value=1, max_value=20000, valid_example="250", invalid_example="0"),
            _f(label="Reference", attr="reference", required=False,
               error_invalid="Reference is limited to 40 characters.",
               max_len=40, valid_example="August rent"),
        ),
        security_error="Reference contains characters that are not allowed.",
        server_error="Transfers are temporarily unavailable. Your balance is unchanged.",
    ),
    Feature(
        key="payee_add", app="Nova Bank", base_url="http://localhost:8004",
        req_id="REQ-14", name="Saved payee creation", actor="account holder",
        benefit="frequent recipients are one tap away",
        path="/payees/new", heading="Add a payee", submit_label="Save payee",
        success_kind="message", success_text="Payee saved to your list.",
        precondition="User is signed in",
        fields=(
            _f(label="Payee name", attr="payee_name",
               error_required="Enter the payee's name.", valid_example="Rita Sharma"),
            _f(label="Account number", attr="account_number",
               error_required="Enter the account number.",
               error_invalid="Account number must be 8 to 12 digits.",
               invalid_example="99", valid_example="004598231277"),
            _f(label="Confirm account number", attr="confirm_account",
               error_required="Re-enter the account number.",
               error_invalid="Account numbers do not match.",
               invalid_example="004598231278", valid_example="004598231277"),
        ),
        duplicate_error="This payee already exists in your list.",
    ),
    Feature(
        key="password_change", app="Nova Bank", base_url="http://localhost:8004",
        req_id="REQ-15", name="Password change", actor="account holder",
        benefit="my online banking stays secure",
        path="/settings/security/password", heading="Change password", submit_label="Update password",
        success_kind="message", success_text="Your password has been updated.",
        precondition="User is signed in",
        fields=(
            _f(label="Current password", attr="current_password", kind="password",
               error_required="Enter your current password.",
               secret_env="QA_TEST_PASSWORD", from_credentials="password"),
            _f(label="New password", attr="new_password", kind="password",
               error_required="Enter a new password.",
               error_invalid="New password must be at least 12 characters with a number and a symbol.",
               invalid_example="weakpass", secret_env="QA_NEW_PASSWORD"),
            _f(label="Confirm new password", attr="confirm_password", kind="password",
               error_required="Confirm the new password.",
               error_invalid="New passwords do not match.",
               secret_env="QA_NEW_PASSWORD"),
        ),
    ),
    # ----- Atlas Travel ----------------------------------------------------
    Feature(
        key="flight_search", app="Atlas Travel", base_url="http://localhost:8005",
        req_id="REQ-16", name="Flight search", actor="traveller",
        benefit="I can compare flights for my trip dates",
        path="/flights", heading="Find flights", submit_label="Search flights",
        success_kind="results", success_text="Matching flights are listed",
        results_terms=("WLG", "???"),
        empty_results_text="No flights found for this route and date.",
        fields=(
            _f(label="From", attr="origin", kind="select",
               error_required="Choose a departure airport.",
               options=("WLG — Wellington", "AKL — Auckland", "CHC — Christchurch"),
               valid_example="WLG — Wellington"),
            _f(label="To", attr="destination", kind="select",
               error_required="Choose a destination airport.",
               options=("AKL — Auckland", "SYD — Sydney", "SIN — Singapore"),
               valid_example="SYD — Sydney"),
            _f(label="Departure date", attr="depart_date", kind="date",
               error_required="Pick a departure date.",
               error_invalid="Departure date cannot be in the past.",
               invalid_example="2020-06-01", valid_example="2026-10-02"),
            _f(label="Passengers", attr="passengers", kind="number",
               error_required="Enter the number of passengers.",
               error_invalid="Passengers must be between 1 and 9.",
               min_value=1, max_value=9, valid_example="2", invalid_example="0"),
        ),
    ),
    Feature(
        key="hotel_review", app="Atlas Travel", base_url="http://localhost:8005",
        req_id="REQ-17", name="Hotel review submission", actor="traveller who completed a stay",
        benefit="other travellers can rely on real experiences",
        path="/hotels/atlas-grand/review", heading="Review your stay", submit_label="Publish review",
        success_kind="message", success_text="Your review has been published.",
        precondition="User is signed in and has a completed stay",
        fields=(
            _f(label="Review title", attr="title",
               error_required="Give your review a title.",
               error_invalid="Titles are limited to 80 characters.",
               max_len=80, valid_example="Quiet rooms, great breakfast"),
            _f(label="Rating", attr="rating", kind="number",
               error_required="Choose a rating from 1 to 5.",
               error_invalid="Rating must be between 1 and 5.",
               min_value=1, max_value=5, valid_example="5", invalid_example="0"),
            _f(label="Your review", attr="body", kind="textarea",
               error_required="Write your review before publishing.",
               error_invalid="Reviews are limited to 3000 characters.",
               max_len=3000, valid_example="Check-in was fast and the room was spotless."),
        ),
        security_error="Reviews may not contain script tags.",
    ),
    Feature(
        key="traveller_profile", app="Atlas Travel", base_url="http://localhost:8005",
        req_id="REQ-18", name="Traveller profile update", actor="traveller",
        benefit="bookings are pre-filled with my details",
        path="/profile", heading="Your profile", submit_label="Save profile",
        success_kind="message", success_text="Profile saved.",
        precondition="User is signed in",
        fields=(
            _f(label="Display name", attr="display_name",
               error_required="Enter a display name.", valid_example="Ari K."),
            _f(label="Phone", attr="phone", required=False,
               error_invalid="Enter a valid phone number.",
               invalid_example="phone-number", valid_example="+64 21 555 0192"),
            _f(label="Send me deal alerts", attr="deal_alerts", kind="checkbox",
               required=False),
        ),
    ),
    # ----- Quill Docs ------------------------------------------------------
    Feature(
        key="document_create", app="Quill Docs", base_url="http://localhost:8006",
        req_id="REQ-19", name="Document creation", actor="workspace user",
        benefit="notes and specs live in one shared place",
        path="/documents/new", heading="New document", submit_label="Create document",
        success_kind="redirect", success_text="Untitled section", success_path="/documents/",
        precondition="User is signed in",
        fields=(
            _f(label="Title", attr="title",
               error_required="Enter a document title.",
               error_invalid="Titles are limited to 120 characters.",
               max_len=120, valid_example="Q3 launch checklist"),
            _f(label="Folder", attr="folder", kind="select",
               error_required="Choose a folder.",
               options=("Product", "Engineering", "Marketing", "Private"),
               valid_example="Product"),
        ),
    ),
    Feature(
        key="document_share", app="Quill Docs", base_url="http://localhost:8006",
        req_id="REQ-20", name="Document sharing", actor="document owner",
        benefit="teammates can read or edit my document",
        path="/documents/305/share", heading="Share document", submit_label="Share",
        success_kind="message", success_text="Access granted.",
        precondition="User is signed in and owns the document",
        roles=("owner", "viewer"), role_error="Only the document owner can change sharing.",
        fields=(
            _f(label="Teammate email", attr="email", kind="email",
               error_required="Enter a teammate's email.",
               error_invalid="Enter a valid email address.",
               invalid_example="sam@@quill", valid_example="sam@quill.example"),
            _f(label="Permission", attr="permission", kind="select",
               error_required="Choose a permission level.",
               options=("Can view", "Can comment", "Can edit"),
               valid_example="Can edit"),
        ),
        duplicate_error="This teammate already has access.",
    ),
    Feature(
        key="api_token_create", app="Quill Docs", base_url="http://localhost:8006",
        req_id="REQ-21", name="API token creation", actor="workspace admin",
        benefit="integrations can call the Quill API on my behalf",
        path="/settings/api-tokens/new", heading="Create API token", submit_label="Create token",
        success_kind="message", success_text="Token created. Copy it now — it is shown only once.",
        precondition="User is signed in as a workspace admin",
        roles=("admin", "member"), role_error="Only admins can create API tokens.",
        fields=(
            _f(label="Token label", attr="label",
               error_required="Give the token a label.",
               error_invalid="Labels are limited to 60 characters.",
               max_len=60, valid_example="CI pipeline"),
            _f(label="Expiry", attr="expiry", kind="select",
               error_required="Choose when the token expires.",
               options=("30 days", "90 days", "1 year"), valid_example="90 days"),
        ),
    ),
    # ----- Mosaic Learning -------------------------------------------------
    Feature(
        key="course_enroll", app="Mosaic Learning", base_url="http://localhost:8007",
        req_id="REQ-22", name="Course enrolment", actor="student",
        benefit="I can join a course my school licensed",
        path="/courses/enroll", heading="Enrol in a course", submit_label="Enrol",
        success_kind="message", success_text="You're enrolled. The course now appears on your dashboard.",
        precondition="User is signed in as a student",
        fields=(
            _f(label="Course", attr="course", kind="select",
               error_required="Choose a course.",
               options=("Algebra Basics", "Creative Writing", "Intro to Biology"),
               valid_example="Creative Writing"),
            _f(label="Access code", attr="access_code",
               error_required="Enter the access code from your teacher.",
               error_invalid="This access code is not recognised.",
               invalid_example="WRONG-CODE", valid_example="MOSAIC-2026"),
        ),
    ),
    Feature(
        key="assignment_upload", app="Mosaic Learning", base_url="http://localhost:8007",
        req_id="REQ-23", name="Assignment upload", actor="student",
        benefit="my work is submitted before the deadline",
        path="/assignments/512/submit", heading="Submit assignment", submit_label="Submit",
        success_kind="message", success_text="Assignment submitted. You can resubmit until the deadline.",
        precondition="User is signed in and enrolled in the course",
        fields=(
            _f(label="Submission title", attr="title",
               error_required="Enter a title for your submission.",
               valid_example="Essay draft 2"),
            _f(label="File", attr="file", kind="file",
               error_required="Attach a file to submit.",
               error_invalid="Only PDF or DOCX files up to 10 MB are accepted.",
               invalid_example="notes.exe", valid_example="essay.pdf"),
        ),
        server_error="Upload failed. Your previous submission is unchanged.",
    ),
    Feature(
        key="certificate_request", app="Mosaic Learning", base_url="http://localhost:8007",
        req_id="REQ-24", name="Completion certificate request", actor="student who finished a course",
        benefit="I can prove course completion to my school",
        path="/certificates/request", heading="Request a certificate", submit_label="Request certificate",
        success_kind="message", success_text="Certificate requested. It will be emailed within 24 hours.",
        precondition="User is signed in and completed the course",
        fields=(
            _f(label="Full legal name", attr="legal_name",
               error_required="Enter your full legal name as it should appear.",
               valid_example="Amelia J. Parata"),
            _f(label="Email for delivery", attr="email", kind="email",
               error_required="Enter the email to deliver the certificate to.",
               error_invalid="Enter a valid email address.",
               invalid_example="amelia.parata", valid_example="amelia@example.org"),
        ),
    ),
    # ----- Beacon Helpdesk (HELD OUT for evaluation) -----------------------
    Feature(
        key="ticket_create", app="Beacon Helpdesk", base_url="http://localhost:8008",
        req_id="REQ-25", name="Support ticket creation", actor="customer",
        benefit="my issue reaches the right support queue",
        path="/tickets/new", heading="Open a ticket", submit_label="Create ticket",
        success_kind="message", success_text="Ticket created. Your reference is shown above.",
        holdout=True,
        fields=(
            _f(label="Subject", attr="subject",
               error_required="Enter a subject.",
               error_invalid="Subjects are limited to 120 characters.",
               max_len=120, valid_example="Invoice PDF fails to download"),
            _f(label="Category", attr="category", kind="select",
               error_required="Choose a category.",
               options=("Billing", "Technical", "Account", "Other"),
               valid_example="Billing"),
            _f(label="Priority", attr="priority", kind="select",
               error_required="Choose a priority.",
               options=("Low", "Normal", "High"), valid_example="Normal"),
            _f(label="Description", attr="description", kind="textarea",
               error_required="Describe the issue.",
               error_invalid="Descriptions are limited to 5000 characters.",
               max_len=5000, valid_example="Clicking Download on invoice #4411 shows a spinner forever."),
        ),
        security_error="Descriptions may not contain script tags.",
    ),
    Feature(
        key="ticket_reply", app="Beacon Helpdesk", base_url="http://localhost:8008",
        req_id="REQ-26", name="Agent ticket reply", actor="support agent",
        benefit="customers get answers inside the ticket thread",
        path="/tickets/9021/reply", heading="Reply to ticket", submit_label="Send reply",
        success_kind="message", success_text="Reply sent to the customer.",
        precondition="User is signed in as a support agent",
        roles=("agent", "customer"), role_error="Only support agents can reply from this view.",
        holdout=True,
        fields=(
            _f(label="Reply", attr="reply", kind="textarea",
               error_required="Write a reply before sending.",
               error_invalid="Replies are limited to 4000 characters.",
               max_len=4000, valid_example="Thanks — a fixed invoice PDF is attached."),
            _f(label="Set status", attr="status", kind="select",
               error_required="Choose the ticket status.",
               options=("Open", "Pending customer", "Resolved"),
               valid_example="Pending customer"),
        ),
    ),
    Feature(
        key="kb_search", app="Beacon Helpdesk", base_url="http://localhost:8008",
        req_id="REQ-27", name="Knowledge base search", actor="customer",
        benefit="I can self-serve before opening a ticket",
        path="/kb", heading="Search the knowledge base", submit_label="Search",
        success_kind="results", success_text="Matching articles are listed",
        results_terms=("reset password", "qqqzz"),
        empty_results_text="No articles matched your search.",
        holdout=True,
        fields=(
            _f(label="Search articles", attr="query",
               error_required="Type a word or phrase to search.",
               valid_example="reset password", max_len=120),
        ),
    ),
)


TRAIN_FEATURES: tuple[Feature, ...] = tuple(f for f in FEATURES if not f.holdout)
HOLDOUT_FEATURES: tuple[Feature, ...] = tuple(f for f in FEATURES if f.holdout)


# ---------------------------------------------------------------------------
# Requirement + analysis generators
# ---------------------------------------------------------------------------


def _field_rule_sentences(feature: Feature) -> list[str]:
    out: list[str] = []
    for f in feature.fields:
        bits: list[str] = []
        if f.required:
            bits.append(f"'{f.label}' is required" + (f" — showing \"{f.error_required}\" when missing" if f.error_required else ""))
        else:
            bits.append(f"'{f.label}' is optional")
        if f.kind == "email":
            bits.append(f"it must be a valid email address (otherwise: \"{f.error_invalid}\")")
        elif f.kind == "number" and f.min_value is not None and f.max_value is not None:
            bits.append(
                f"it accepts whole numbers from {f.min_value} to {f.max_value} "
                f"(otherwise: \"{f.error_invalid}\")"
            )
        elif f.max_len and f.error_invalid:
            bits.append(f"it is limited to {f.max_len} characters (otherwise: \"{f.error_invalid}\")")
        elif f.error_invalid and f.invalid_example:
            bits.append(f"invalid values are rejected with \"{f.error_invalid}\"")
        if f.kind == "select" and f.options:
            bits.append("options: " + ", ".join(f.options))
        out.append("; ".join(bits) + ".")
    return out


def _success_sentence(feature: Feature) -> str:
    if feature.success_kind == "message":
        return f'On success the page shows "{feature.success_text}".'
    if feature.success_kind == "redirect":
        return (
            f"On success the user is redirected to {feature.success_path} where the "
            f'"{feature.success_text}" heading is shown.'
        )
    return (
        f"On success {feature.success_text.lower()}; when nothing matches, the page shows "
        f'"{feature.empty_results_text}".'
    )


def make_requirement(feature: Feature, phrasing: str = "formal") -> dict:
    """Requirement dict in the shape the backend sends: id/title/text/acceptance_criteria."""
    rules = _field_rule_sentences(feature)
    extra: list[str] = []
    if feature.roles:
        extra.append(f"Access rule: {feature.role_error}")
    if feature.duplicate_error:
        extra.append(f'Duplicate submissions are rejected with "{feature.duplicate_error}".')
    if feature.server_error:
        extra.append(f'If the backend fails, the page shows "{feature.server_error}".')
    if feature.security_error:
        extra.append(f'Inputs containing markup such as <script> are rejected with "{feature.security_error}".')
    if feature.precondition:
        extra.append(f"Precondition: {feature.precondition}.")

    if phrasing == "formal":
        text = (
            f"The system shall provide a {feature.name.lower()} form at {feature.path} "
            f"titled \"{feature.heading}\" with a \"{feature.submit_label}\" action. "
            + " ".join(rules) + " " + _success_sentence(feature)
            + (" " + " ".join(extra) if extra else "")
        )
        title = feature.name
    else:
        text = (
            f"As a {feature.actor}, I want to use the \"{feature.heading}\" page at "
            f"{feature.path} so that {feature.benefit}. "
            f"Submitting with \"{feature.submit_label}\" validates my input: "
            + " ".join(rules) + " " + _success_sentence(feature)
            + (" " + " ".join(extra) if extra else "")
        )
        title = f"{feature.name} ({feature.actor})"

    criteria = [_success_sentence(feature)]
    for f in feature.fields:
        if f.required and f.error_required:
            criteria.append(f'Submitting without \'{f.label}\' shows "{f.error_required}".')
        if f.error_invalid and (f.invalid_example or f.max_len or f.min_value is not None):
            criteria.append(f'An invalid \'{f.label}\' shows "{f.error_invalid}".')
    criteria.extend(extra)
    return {
        "id": feature.req_id,
        "title": title,
        "text": text,
        "acceptance_criteria": criteria,
    }


def make_analysis(feature: Feature) -> dict:
    """RequirementAnalysisOutput-shaped dict, as the backend serialises it."""
    main_flow = [f"Open {feature.path}."]
    for f in feature.fields:
        verb = {
            "select": "Select a value for", "checkbox": "Tick", "file": "Attach a file to",
        }.get(f.kind, "Fill in")
        main_flow.append(f"{verb} '{f.label}'.")
    main_flow.append(f"Activate '{feature.submit_label}'.")
    main_flow.append(_success_sentence(feature))

    alt_flows = [
        f"Missing '{f.label}' → \"{f.error_required}\"."
        for f in feature.fields if f.required and f.error_required
    ] + [
        f"Invalid '{f.label}' → \"{f.error_invalid}\"."
        for f in feature.fields if f.error_invalid
    ]
    business_rules = [s for s in _field_rule_sentences(feature)]
    if feature.duplicate_error:
        alt_flows.append(f'Duplicate submission → "{feature.duplicate_error}".')
    if feature.roles:
        business_rules.append(feature.role_error)

    risk_score = 7 if feature.app == "Nova Bank" else 5
    return {
        "requirement_id": feature.req_id,
        "actors": [feature.actor] + (list(feature.roles) if feature.roles else []),
        "preconditions": [feature.precondition or "The application is reachable."],
        "triggers": [f"The {feature.actor} opens {feature.path}."],
        "main_flow": main_flow,
        "alternative_flows": alt_flows,
        "business_rules": business_rules,
        "expected_outcomes": [_success_sentence(feature)],
        "assumptions": ["Field validation happens on submit, not on blur."],
        "issues": [
            {
                "issue": "The requirement does not state whether validation errors are shown per field or in a single summary.",
                "kind": "ambiguity",
                "clarification_question": "Are validation messages rendered per field, in one alert region, or both?",
            }
        ],
        "risk": {
            "business_impact": "high" if risk_score >= 7 else "medium",
            "technical_complexity": "medium",
            "testability": "high",
            "score": risk_score,
            "rationale": f"{feature.name} is a user-facing flow with explicit validation rules; failures are visible immediately.",
        },
    }
