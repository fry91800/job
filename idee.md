Field	Type	Description
id	UUID	Internal unique identifier
title	TEXT	Job title
company	TEXT	Company name
description	TEXT	Full job description
url	TEXT	Original job offer URL
location	TEXT	Job location
remote_type	TEXT	Remote / hybrid / onsite
contract_type	TEXT	CDI / CDD / freelance / internship, etc.
salary_min	INTEGER	Minimum salary, if available
salary_max	INTEGER	Maximum salary, if available
salary_currency	CHAR(3)	Currency, e.g. EUR, CHF, USD
published_at	TIMESTAMP	Date the job was published, if known
collected_at	TIMESTAMP	First time your system collected the job
last_verified_at	TIMESTAMP	Last time your crawler verified that the offer was still valid
source	TEXT	Source name, e.g. LinkedIn, Indeed, company website
external_id	TEXT	ID of the job on the source, if available
raw_data	JSONB	Original/raw data collected from the source