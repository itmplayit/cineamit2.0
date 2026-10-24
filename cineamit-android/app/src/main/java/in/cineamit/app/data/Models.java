package in.cineamit.app.data;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class Models {
    private Models() {}

    public static class MediaItem {
        public long id;
        public String media_type = "movie";
        public String title = "";
        public String poster_path = "";
        public String backdrop_path = "";
        public double vote_average;
        public String year = "";
        public String overview = "";
        public List<String> genres = new ArrayList<>();
        public int runtime;
        public String tagline = "";
        public String logo_path = "";
        public String original_language = "";
        public int[] genre_ids = new int[0];
        public boolean is_anime;
    }

    public static class HomeRow {
        public String id = "";
        public String title = "";
        public String browse = "";
        public List<MediaItem> items = new ArrayList<>();
    }

    public static class Studio {
        public long id;
        public String name = "";
        public String thumbnail_url = "";
    }

    public static class Provider {
        public long provider_id;
        public String provider_name = "";
        public String logo_path = "";
    }

    public static class Server {
        public String name = "";
        public String play = "";
        public boolean vip;
    }

    public static class Season {
        public int season_number;
        public String name = "";
        public int episode_count;
        public String poster_path = "";
    }

    public static class Episode {
        public int episode_number;
        public String name = "";
        public String overview = "";
        public String still_path = "";
        public int runtime;
    }

    public static class CastPerson {
        public long id;
        public String name = "";
        public String character = "";
        public String profile_path = "";
        public String media_type = "person";
    }

    public static class AppUser {
        public long id;
        public String username = "";
        public String role = "user";
        public boolean is_kids;
        public long profile_id;
        public String profile_name = "";
        public boolean autoplay_next = true;
        public boolean totp_enabled;
        public String emailMasked = "";
    }

    public static class UserProfile {
        public long id;
        public String name = "";
        public boolean is_kids;
        public boolean has_pin;
        public String color = "";
    }

    public static class LiveChannel {
        public String name = "";
        public String logo = "";
        public String category = "All";
        public String tvg_id = "";
        public String play = "";
        public String source = "";
        public String cmd = "";
    }

    public static class VodItem {
        public String id = "";
        public String name = "";
        public String logo = "";
        public String category = "";
        public String year = "";
        public String kind = "movie";
        public String source = "";
        public String language = "";
        public boolean has_episodes;
        public String play = "";
    }

    public static class VodEpisode {
        public int episode_number;
        public String name = "";
        public String play = "";
        public String still = "";
    }

    public static class VodSeason {
        public int season_number;
        public String name = "";
        public List<VodEpisode> episodes = new ArrayList<>();
    }

    public static class Session {
        public static AppUser user;
        public static String imageBase = "https://image.tmdb.org/t/p";
        public static String site = "CineAmit";
    }

    public static <T> List<T> empty() {
        return Collections.emptyList();
    }
}
