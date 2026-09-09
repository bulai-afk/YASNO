USE svodka;

CREATE TABLE IF NOT EXISTS reports (
  id CHAR(36) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  site_host VARCHAR(255) NOT NULL,
  report_type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  status ENUM(
    'draft',
    'queued',
    'collecting',
    'analyzing',
    'rendering',
    'ready',
    'error',
    'cancelled'
  ) NOT NULL DEFAULT 'queued',
  progress_pct TINYINT UNSIGNED NOT NULL DEFAULT 0,
  phase_label VARCHAR(255) NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  compare_from DATE NULL,
  compare_to DATE NULL,
  config_json JSON NOT NULL,
  result_json JSON NULL,
  error_text TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reports_user_created (user_id, created_at),
  KEY idx_reports_user_status (user_id, status),
  KEY idx_reports_project (user_id, project_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_templates (
  id CHAR(36) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  config_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_report_templates_user (user_id, updated_at)
) ENGINE=InnoDB;