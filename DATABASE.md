This file contains the architecture and naming conventions for the database.
Naming conventions:

* Use `PascalCase` for Prisma model names (singular).
* Use `snake_case` for PostgreSQL table names (plural) and column names.
* Use `camelCase` for Prisma fields, mapping them to PostgreSQL columns with `@map("column_name")`.
* Use `@@map("table_name")` to map Prisma models to PostgreSQL tables.
* Use `id` for primary keys and `{relatedModel}Id` for foreign keys.
* Use `createdAt`, `updatedAt`, and `deletedAt` for timestamps, mapped to `created_at`, `updated_at`, and `deleted_at`.
* Use descriptive, consistent names; avoid unnecessary abbreviations.
* Keep naming conventions consistent across the entire database.


### User Table:
This table stores information about the users of the system. This also stores the user's preferences and settings related to resume searches / generation such as the selected template, modifier settings, and last search location.


Field	Type	Description	Mandatory	Default
id	UUID	Auto-generated primary key	Yes	Auto-generated
email	TEXT	User's email address; unique and used for login	Yes	
password_hash	TEXT	Secure password hash; never store the plain-text password	Yes	
search_location_id	INTEGER	location of the last search; foreign key to location.id		
modifier_enabled	BOOLEAN	User's modifier state, true if enabled	Yes	False
modifier_strength_id	INTEGER	Strength of the modifier; foreign id key to modifier id	Yes	1
modifier_config	JSONB	Tells the modifier what field can be changed in the resume JSON	Yes	{ "summary": true, "skills": true} 
template_id	INTEGER	User’s selected template ; foreign key to template id	Yes	1
created_at	TIMESTAMP	Date and time the account was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now
deleted_at	TIMESTAMP	Date and time the record was deleted	No	NULL

### Modifier Strength Table:
This table stores information about the different modifier strengths that can be applied to resumes.

Field	Type	Description	Mandatory	Default
id	INTEGER	Auto-generated primary key	Yes	Auto-generated
name	TEXT	Strength name (Soft, Medium, Hard)	Yes	
rules	TEXT	Rules stored for the AI prompt when generating a resume	Yes	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now
deleted_at	TIMESTAMP	Date and time the record was deleted	No	NULL



### User photos
This table stores information about the photos uploaded by users for their resumes.
A user can have multiple photos, but only one can be active for resume generation at a time.

Field	Type	Description	Mandatory	Default
id	UUID	Auto-generated primary key	Yes	Auto-generated
user_id	UUID	User who owns this photo; foreign key to User.id	Yes	
name	TEXT	Human-readable name displayed in the UI	Yes	Photo [number]
storage_key	TEXT	Path or object-storage key for the image file; store the file outside the database	Yes	Generated
is_active	BOOLEAN	True if the photo is the one user for resume generation	Yes	False
created_at	TIMESTAMP	Date and time the photo was uploaded	Yes	Now
updated_at	TIMESTAMP	Date and time the record was updated	Yes	Now
deleted_at	TIMESTAMP	Date and time the record was deleted	No	NULL

### Resumes
This table stores information about the resumes created by users. Each resume belongs to a single user, and users can have multiple resumes.

Field	Type	Description	Mandatory	Default
id	UUID	Auto-generated primary key	Yes	Auto-generated
user_id	UUID	User who owns this resume; foreign key to User.id	Yes	
name	TEXT	User-defined name to distinguish resumes in the UI	Yes	resume [number]
content	JSONB	Structured resume data in JSON format	Yes	
language	VARCHAR(10) 	Language code, e.g. en, fr, en-GB 	Yes	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now
deleted_at	TIMESTAMP	Date and time the record was deleted	No	NULL

### Generated Resumes
This table stores information about the resumes that have been generated for users. Each generated resume is associated with a specific user and offer, and may include ai-driven modifications based on user-selected settings.

Field	Type	Description	Mandatory	Default
id	UUID	Auto-generated primary key	Yes	Auto-generated
user_id	UUID	User who owns this generated resume; foreign key to User.id	Yes	
offer_id	UUID	Offer that has been read to generate that resume ; foreign key to Offer.id	Yes	
original_content	JSONB	Structured resume data of the original resume in JSON format	Yes	
modified	BOOLEAN	If the modifier was used for that resume generation	Yes	
modification_strength	INTEGER	Modifier strength used for resume generation, null if the modifier was not active	No	
generated_content	JSONB	Structured resume data of the generated resume in JSON format	Yes	
template_id	INTEGER	Template used to generated the file	Yes	
modifer_config	JSONB	Snapshot of the modifier configuration when generating the resume	Yes	
created_at	TIMESTAMP	Date and time the generated record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the generated record was last updated	Yes	Now
deleted_at	TIMESTAMP	Date and time the generated record was deleted	No	NULL

### Templates:
This table stores information about the templates available for generating resumes. Each template has a name, availability status, preview image, and associated rendering program.

Field	Type	Description	Mandatory	Default
id	INTEGER	Auto-generated primary key	Yes	Auto-generated
name	TEXT	Template name displayed in the UI	Yes	
free	BOOLEAN	True if the template is available for free users	Yes	Yes
preview_storage_key	TEXT	Storage path or object-storage key for the single preview image	Yes	generated
program	TEXT	Path to template rendering program or code	Yes	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now

### Location

This table stores information about the locations associated with users, offers, or other entities in the system. For now, it primarily relies on external location providers (geoapify is the main one) to populate location data.

Field	Type	Description	Mandatory	Default
id	INTEGER	Auto-generated primary key	Yes	Auto-generated
provider	TEXT	provider, exemple geoapify	Yes	
external_id	TEXT	id from the external source	No	NULL
name	TEXT	name of the location	Yes	
countryCode	VARCHAR(2)	Country Code	Yes	
admin_area	TEXT		No	
latitude	FLOAT		No	
longitude 	FLOAT		No	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now


### Offer
This table stores information about job offers collected from various sources. Each offer includes details such as the job title, description, location, salary, and associated user.

Field	Type	Description	Mandatory	Default
id	UUID	Auto-generated primary key	Yes	Auto-generated
title	TEXT	Job title	Yes	
description	TEXT	Full job description	Yes	
url	TEXT	Original job offer URL, must be unique	Yes	
location_id	TEXT	Job location; foreign key to Location.id	No	NULL
remote_type	TEXT	Remote / hybrid / onsite	No	NULL
contract_type	TEXT	CDI / CDD / freelance / internship, etc.	No	NULL
salary_min	INTEGER	Minimum salary, if available	No	NULL
salary_max	INTEGER	Maximum salary, if available	No	NULL
salary_currency	CHAR(3)	Currency, e.g. EUR, CHF, USD	No	NULL
published_at	TIMESTAMP	Date the job was published, if known	No	NULL
collected_at	TIMESTAMP	First time the system collected the job	Yes	Now
last_verified_at	TIMESTAMP	Last time it was verified that the offer was still valid	No	NULL
source	TEXT	Source name, e.g. LinkedIn, Indeed, company website	Yes	
external_id	TEXT	ID of the job on the source, if available	No	
raw_data	JSONB	Original/raw data collected from the source	No	
user_id	UUID	ID of the user who generated the offer, if applicable	No	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now

### Skills
This table stores information about skills that can be associated with job offers or resumes. Skills can originate from various sources, such as manual entry or external catalogues like ESCO.

Field	Type	Description	Mandatory	Default
id	INTEGER	Auto-generated primary key	Yes	Auto-generated
source	TEXT	Origin, e.g. manual or ESCO	Yes	
external_id 	TEXT	ID in an external catalogue, if applicable 	No	NULL
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now


### Skill Names
This table stores the different names for each skill in various languages. It helps in normalizing and matching skill names across different sources and languages.

Field	Type	Description	Mandatory	Default
id	INTEGER	Auto-generated primary key	Yes	Auto-generated
skill_id	INTEGER	original skill ; foreign key to Skill.id	Yes	
language	VARCHAR(10) 	Language code, e.g. en, fr, en-GB 	Yes	
name	TEXT	Normalized form for lookup	Yes	
normalized_name	TEXT	Standardized name used for matching and deduplication. Trim, lowercase, collapse consecutive spaces, normalize Unicode (NFKC). 	Yes	
is_canonical	BOOLEAN	Whether this is the preferred name in that language	Yes	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now

### Occupations
This table stores information about occupations that can be associated with job offers or resumes. Occupations can originate from various sources, such as manual entry or external catalogues like ESCO.

Field	Type	Description	Mandatory	Default
id	INTEGER	Auto-generated primary key	Yes	Auto-generated
source	TEXT	Origin, e.g. manual or ESCO	Yes	
external_id 	TEXT	ID in an external catalogue, if applicable 	No	NULL
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now

### Occupation Names
This table stores the different names for each occupation in various languages. It helps in normalizing and matching occupation names across different sources and languages.

Field	Type	Description	Mandatory	Default
id	INTEGER	Auto-generated primary key	Yes	Auto-generated
occupation_id	INTEGER	original occupation ; foreign key to Occupation.id	Yes
language	VARCHAR(10) 	Language code, e.g. en, fr, en-GB 	Yes	
name	TEXT	Normalized form for lookup	Yes	
normalized_name	TEXT	Standardized name used for matching and deduplication. Trim, lowercase, collapse consecutive spaces, normalize Unicode (NFKC). 	Yes	
is_canonical	BOOLEAN	Whether this is the preferred name in that language	Yes	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now

### Resume skills
This table stores the skills associated with each resume. It allows for linking multiple skills to a single resume and supports many-to-many relationships between resumes and skills.

Field	Type	Description	Mandatory	Default
id	INTEGER	Auto-generated primary key	Yes	Auto-generated
resume_id	INTEGER	Resume linked to the skill; foreign key to Resume.id	Yes	
skill_id	TEXT	Skill linked to the resume; foreign key to Skill.id	Yes	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now

### Offer skills
This table stores the skills associated with each job offer. It allows for linking multiple skills to a single offer and supports many-to-many relationships between offers and skills.

Field	Type	Description	Mandatory	Default
id	INTEGER	Auto-generated primary key	Yes	Auto-generated
offer_id	INTEGER	Offer linked to the skill; foreign key to Offer.id	Yes	
skill_id	TEXT	Skill linked to the offer; foreign key to Skill.id	Yes	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now

### Resume occupation
This table stores the occupations associated with each resume. It allows for linking multiple occupations to a single resume and supports many-to-many relationships between resumes and occupations.

Field	Type	Description	Mandatory	Default
id	INTEGER	Auto-generated primary key	Yes	Auto-generated
resume_id	INTEGER	Resume linked to the occupation; foreign key to Resume.id	Yes	
occupation_id	TEXT	Occupation linked to the resume; foreign key to Occupation.id	Yes
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now

### Offer occupation
This table stores the occupations associated with each job offer. It allows for linking multiple occupations to a single offer and supports many-to-many relationships between offers and occupations.

Field	Type	Description	Mandatory	Default
id	INTEGER	Auto-generated primary key	Yes	Auto-generated
offer_id	INTEGER	Offer linked to the occupation; foreign key to Offer.id	Yes	
occupation_id	TEXT	Occupation linked to the offer; foreign key to Occupation.id	Yes	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now

### Skill relationships
This table stores the relationships between different skills. It allows for defining various types of relationships such as equivalent, related, required, or alternative skills. This will be used to establish connections and dependencies between skills, enabling better skill recommendation.

Field	Type	Description	Mandatory	Default
skill_id	INTEGER	foreign key to skill.id	Yes	
related_skill_id	INTEGER	foreign key to skill.id	Yes	
relationship_type	TEXT	Equivalent, Related, Requires, Alternative	Yes	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now

### Occupation relationships
This table stores the relationships between different occupations. It allows for defining various types of relationships such as equivalent, related, required, or alternative occupations. This will be used to establish connections and dependencies between occupations, enabling better occupation recommendation.

Field	Type	Description	Mandatory	Default
occupation_id	INTEGER	foreign key to occupation.id	Yes	
related_occupation_id	INTEGER	foreign key to occupation.id	Yes	
relationship_type	TEXT	Equivalent, Related, Requires, Alternative	Yes	
created_at	TIMESTAMP	Date and time the record was created	Yes	Now
updated_at	TIMESTAMP	Date and time the record was last updated	Yes	Now
