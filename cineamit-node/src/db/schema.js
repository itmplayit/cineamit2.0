'use strict';

/**
 * Schema v25 table DDL — verbatim CREATE TABLE strings from the original createAll()
 * tables[] array. One source of truth for fresh installs and upgrades.
 */
module.exports = function tableDefinitions() {
  return [
        `CREATE TABLE IF NOT EXISTS rate_limits (
          rate_key VARCHAR(150) PRIMARY KEY,
          cnt INT NOT NULL DEFAULT 0,
          window_start DATETIME NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) NOT NULL UNIQUE,
          email VARCHAR(120) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          profile_image VARCHAR(100) DEFAULT 'default_avatar.png',
          role VARCHAR(20) DEFAULT 'user',
          match_code VARCHAR(20) NOT NULL UNIQUE,
          totp_secret VARCHAR(160) DEFAULT NULL,
          totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
          password_changed_at DATETIME DEFAULT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          last_login DATETIME DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS security_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          event VARCHAR(50) NOT NULL,
          user_id INT DEFAULT NULL,
          ip VARCHAR(45) NOT NULL DEFAULT '',
          details VARCHAR(500) DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          KEY idx_event (event, created_at),
          KEY idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS watch_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          profile_id INT NOT NULL DEFAULT 0,
          tmdb_id INT NOT NULL,
          media_type VARCHAR(20) NOT NULL,
          title VARCHAR(255) NOT NULL,
          poster_path VARCHAR(255),
          genres VARCHAR(255) DEFAULT '',
          watch_time DATETIME DEFAULT CURRENT_TIMESTAMP,
          KEY idx_wh_user (user_id),
          UNIQUE KEY unique_watch (user_id, profile_id, tmdb_id, media_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS watchlist (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          profile_id INT NOT NULL DEFAULT 0,
          tmdb_id INT NOT NULL,
          media_type VARCHAR(20) NOT NULL,
          title VARCHAR(255) NOT NULL,
          poster_path VARCHAR(255),
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          KEY idx_wl_user (user_id),
          UNIQUE KEY uniq_wl_user_profile_tmdb (user_id, profile_id, tmdb_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS user_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          request_type VARCHAR(50) NOT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS user_profiles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          name VARCHAR(50) NOT NULL,
          avatar_color VARCHAR(50) DEFAULT 'bg-red-600',
          avatar_image VARCHAR(255) DEFAULT NULL,
          theme_color VARCHAR(50) DEFAULT 'red',
          last_watch_date DATE DEFAULT NULL,
          binge_streak INT DEFAULT 0,
          pin VARCHAR(255) DEFAULT NULL,
          autoplay_next TINYINT(1) DEFAULT 1,
          default_server VARCHAR(50) DEFAULT 'auto',
          is_kids TINYINT(1) DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS notifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          title VARCHAR(100) NOT NULL,
          message TEXT NOT NULL,
          is_read TINYINT(1) DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS playlist (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          profile_id INT NOT NULL DEFAULT 0,
          name VARCHAR(100) NOT NULL,
          description VARCHAR(255) NULL,
          is_public TINYINT(1) DEFAULT 1,
          share_code VARCHAR(20) NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS playlist_movies (
          id INT AUTO_INCREMENT PRIMARY KEY,
          playlist_id INT NOT NULL,
          tmdb_id INT NOT NULL,
          media_type VARCHAR(20) NOT NULL,
          title VARCHAR(255),
          poster_path VARCHAR(255),
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS server_model (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          movie_pattern VARCHAR(500) NOT NULL,
          tv_pattern VARCHAR(500) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_active TINYINT(1) DEFAULT 1,
          sort_order INT NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS xtream_servers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          host VARCHAR(255) NOT NULL,
          username TEXT NOT NULL,
          password TEXT NOT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          sort_order INT NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          KEY idx_xs_active (is_active, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS download_setting (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) DEFAULT 'Download 1',
          pattern_url VARCHAR(500) NOT NULL,
          media_type_filter VARCHAR(20) DEFAULT 'all',
          is_active TINYINT(1) DEFAULT 1,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS reviews (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          profile_id INT NOT NULL DEFAULT 0,
          tmdb_id INT NOT NULL,
          media_type VARCHAR(10) NOT NULL,
          rating INT NOT NULL,
          review_text TEXT NOT NULL,
          has_spoilers TINYINT(1) DEFAULT 0,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS site_setting (
          id INT AUTO_INCREMENT PRIMARY KEY,
          setting_key VARCHAR(100) NOT NULL UNIQUE,
          setting_value TEXT NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS user_wallet (
          user_id INT PRIMARY KEY,
          points INT NOT NULL DEFAULT 0,
          plan VARCHAR(16) NOT NULL DEFAULT 'free',
          plan_until BIGINT NOT NULL DEFAULT 0,
          seeded TINYINT(1) NOT NULL DEFAULT 0,
          trial_used TINYINT(1) NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS web_watch_hits (
          viewer_key VARCHAR(80) NOT NULL,
          title_key VARCHAR(80) NOT NULL,
          day_key CHAR(10) NOT NULL,
          watched_at DATETIME NOT NULL,
          PRIMARY KEY (viewer_key, title_key, day_key),
          KEY idx_wwh_viewer_day (viewer_key, day_key),
          KEY idx_wwh_watched (watched_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS app_ad_tickets (
          user_id INT NOT NULL,
          ticket CHAR(32) NOT NULL,
          expires_at BIGINT NOT NULL,
          PRIMARY KEY (user_id, ticket),
          KEY idx_aat_exp (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS proxies (
          id INT AUTO_INCREMENT PRIMARY KEY,
          url VARCHAR(255) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS party_messages (
          id INT AUTO_INCREMENT PRIMARY KEY,
          room VARCHAR(50) NOT NULL,
          username VARCHAR(100) NOT NULL,
          msg_type VARCHAR(10) NOT NULL DEFAULT 'user',
          msg TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          KEY idx_room (room, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS blog_posts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          slug VARCHAR(255) NOT NULL UNIQUE,
          image_url VARCHAR(500) DEFAULT '',
          content MEDIUMTEXT NOT NULL,
          meta_description VARCHAR(255) DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS help_articles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          topic VARCHAR(50) NOT NULL,
          title VARCHAR(255) NOT NULL,
          slug VARCHAR(255) NOT NULL UNIQUE,
          content MEDIUMTEXT NOT NULL,
          views INT DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS cine_match_friends (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          friend_id INT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_friend (user_id, friend_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS password_otp (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(120) NOT NULL,
          otp_hash VARCHAR(255) NOT NULL,
          expires_at DATETIME NOT NULL,
          attempts INT NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          KEY idx_email (email),
          KEY idx_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS oauth_accounts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          provider VARCHAR(20) NOT NULL,
          provider_user_id VARCHAR(191) NOT NULL,
          email VARCHAR(191) DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_provider_user (provider, provider_user_id),
          KEY idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS active_sessions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          session_id VARCHAR(128) NOT NULL,
          ip VARCHAR(45) NOT NULL DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_session (session_id),
          KEY idx_as_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS content_blacklist (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tmdb_id INT NOT NULL,
          title VARCHAR(255) NOT NULL DEFAULT '',
          reason VARCHAR(255) NOT NULL DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_tmdb (tmdb_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS live_presence (
          user_id INT PRIMARY KEY,
          username VARCHAR(100) NOT NULL,
          profile_name VARCHAR(50) DEFAULT NULL,
          current_page VARCHAR(255) DEFAULT '',
          content_title VARCHAR(255) DEFAULT '',
          ip VARCHAR(45) DEFAULT '',
          last_seen DATETIME NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS source_health (
          id INT AUTO_INCREMENT PRIMARY KEY,
          server_id INT NOT NULL,
          ok TINYINT(1) NOT NULL DEFAULT 0,
          latency_ms INT NOT NULL DEFAULT 0,
          note VARCHAR(255) DEFAULT '',
          checked_at DATETIME NOT NULL,
          KEY idx_sh_server (server_id, checked_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS announcements (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(150) NOT NULL,
          message TEXT NOT NULL,
          display_type VARCHAR(10) NOT NULL DEFAULT 'banner',
          start_at DATETIME DEFAULT NULL,
          end_at DATETIME DEFAULT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_by INT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS announcement_reads (
          announcement_id INT NOT NULL,
          user_id INT NOT NULL,
          read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (announcement_id, user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS error_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          ip VARCHAR(45) DEFAULT '',
          url VARCHAR(255) DEFAULT '',
          http_code INT NOT NULL DEFAULT 500,
          message VARCHAR(500) DEFAULT '',
          KEY idx_el_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ];
};
