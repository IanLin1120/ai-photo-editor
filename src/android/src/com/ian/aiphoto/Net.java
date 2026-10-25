package com.ian.aiphoto;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.GZIPInputStream;

public class Net {
    public static class Resp {
        public int code;
        public String mime;
        public String lastModified;
        public InputStream stream;
    }

    public static Resp open(String url, String ifModifiedSince, int timeout) throws Exception {
        HttpURLConnection c = null;
        for (int hop = 0; hop < 5; hop++) {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(Math.min(timeout, 15000));
            c.setReadTimeout(timeout);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", "AIPhoto/" + BuildInfo.VERSION + " (Android)");
            c.setRequestProperty("Accept-Encoding", "gzip");
            if (ifModifiedSince != null) c.setRequestProperty("If-Modified-Since", ifModifiedSince);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && code != 304) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) break;
                url = new URL(new URL(url), loc).toString();
                continue;
            }
            break;
        }
        Resp r = new Resp();
        r.code = c.getResponseCode();
        r.mime = c.getContentType();
        r.lastModified = c.getHeaderField("Last-Modified");
        InputStream in = r.code >= 400 ? c.getErrorStream() : (r.code == 304 ? null : c.getInputStream());
        if (in != null && "gzip".equalsIgnoreCase(c.getContentEncoding())) in = new GZIPInputStream(in);
        r.stream = in;
        return r;
    }

    public static byte[] bytes(String url, int timeout) throws Exception {
        Resp r = open(url, null, timeout);
        if (r.code != 200 || r.stream == null) throw new Exception("HTTP " + r.code);
        return readAll(r.stream);
    }

    public static String text(String url, int timeout) throws Exception {
        return new String(bytes(url, timeout), "UTF-8");
    }

    public static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) o.write(b, 0, n);
        in.close();
        return o.toByteArray();
    }
}
