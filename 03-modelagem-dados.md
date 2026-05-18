# Modelagem Inicial de Dados

## Entidades principais
- User
- AthleteProfile
- OrganizerProfile
- Event
- EventModality
- EventRoute
- EventCategory
- TicketBatch
- TicketType
- Registration
- RegistrationAnswer
- Order
- Payment
- Coupon
- Refund
- TransferPayout
- ResultImport
- RaceResult
- AuditLog
- FileAsset

## Campos essenciais

### Event
- id
- organizer_id
- title
- slug
- description
- modality
- status
- start_at
- venue_name
- address
- city
- state
- country
- banner_url
- regulation_url
- organizer_contact
- published_at
- created_at
- updated_at

### Registration
- id
- event_id
- athlete_user_id
- route_id
- category_id
- ticket_type_id
- order_id
- bib_number
- shirt_size
- team_name
- emergency_contact_name
- emergency_contact_phone
- medical_notes
- status
- accepted_terms_at
- created_at

### Order
- id
- buyer_user_id
- event_id
- subtotal_amount
- platform_fee_amount
- payment_fee_amount
- total_amount
- currency
- status
- created_at

### Payment
- id
- order_id
- provider
- provider_payment_id
- method
- status
- amount
- paid_at
- raw_payload_json
