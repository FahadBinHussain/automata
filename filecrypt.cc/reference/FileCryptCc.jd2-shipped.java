/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  jd.PluginWrapper
 *  jd.controlling.ProgressController
 *  jd.http.Browser
 *  jd.http.Request
 *  jd.nutils.encoding.Encoding
 *  jd.parser.Regex
 *  jd.parser.html.Form
 *  jd.parser.html.Form$MethodType
 *  jd.parser.html.InputField
 *  jd.parser.html.InputField$InputType
 *  jd.plugins.Account
 *  jd.plugins.CryptedLink
 *  jd.plugins.DecrypterException
 *  jd.plugins.DecrypterPlugin
 *  jd.plugins.DecrypterRetryException
 *  jd.plugins.DecrypterRetryException$RetryReason
 *  jd.plugins.DownloadLink
 *  jd.plugins.FilePackage
 *  jd.plugins.PluginException
 *  jd.plugins.PluginForDecrypt
 *  org.appwork.storage.JSonStorage
 *  org.appwork.utils.StringUtils
 *  org.appwork.utils.formatter.HexFormatter
 *  org.appwork.utils.formatter.SizeFormatter
 *  org.appwork.utils.net.URLHelper
 *  org.appwork.utils.parser.UrlQuery
 *  org.jdownloader.captcha.v2.challenge.clickcaptcha.ClickedPoint
 *  org.jdownloader.captcha.v2.challenge.cutcaptcha.CaptchaHelperCrawlerPluginCutCaptcha
 *  org.jdownloader.captcha.v2.challenge.recaptcha.v2.AbstractRecaptchaV2
 *  org.jdownloader.captcha.v2.challenge.recaptcha.v2.CaptchaHelperCrawlerPluginRecaptchaV2
 *  org.jdownloader.plugins.components.config.FileCryptConfig
 *  org.jdownloader.plugins.components.config.FileCryptConfig$CrawlMode
 *  org.jdownloader.plugins.config.PluginJsonConfig
 */
package jd.plugins.decrypter;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import jd.PluginWrapper;
import jd.controlling.ProgressController;
import jd.http.Browser;
import jd.http.Request;
import jd.nutils.encoding.Encoding;
import jd.parser.Regex;
import jd.parser.html.Form;
import jd.parser.html.InputField;
import jd.plugins.Account;
import jd.plugins.CryptedLink;
import jd.plugins.DecrypterException;
import jd.plugins.DecrypterPlugin;
import jd.plugins.DecrypterRetryException;
import jd.plugins.DownloadLink;
import jd.plugins.FilePackage;
import jd.plugins.PluginException;
import jd.plugins.PluginForDecrypt;
import org.appwork.storage.JSonStorage;
import org.appwork.utils.StringUtils;
import org.appwork.utils.formatter.HexFormatter;
import org.appwork.utils.formatter.SizeFormatter;
import org.appwork.utils.net.URLHelper;
import org.appwork.utils.parser.UrlQuery;
import org.jdownloader.captcha.v2.challenge.clickcaptcha.ClickedPoint;
import org.jdownloader.captcha.v2.challenge.cutcaptcha.CaptchaHelperCrawlerPluginCutCaptcha;
import org.jdownloader.captcha.v2.challenge.recaptcha.v2.AbstractRecaptchaV2;
import org.jdownloader.captcha.v2.challenge.recaptcha.v2.CaptchaHelperCrawlerPluginRecaptchaV2;
import org.jdownloader.plugins.components.config.FileCryptConfig;
import org.jdownloader.plugins.config.PluginJsonConfig;

@DecrypterPlugin(revision="$Revision: 52828 $", interfaceVersion=3, names={}, urls={})
public class FileCryptCc
extends PluginForDecrypt {
    private static final String PROPERTY_PLUGIN_LAST_USED_PASSWORD = "last_used_password";
    private String logoPW = null;
    private String successfullyUsedFolderPassword = null;
    private final Map<String, String> LOGO_PASSWORD_MAP = new HashMap<String, String>();
    private String cleanHTML = null;

    public FileCryptCc(PluginWrapper wrapper) {
        super(wrapper);
    }

    public int getMaxConcurrentProcessingInstances() {
        return 1;
    }

    public Browser createNewBrowserInstance() {
        Browser br = super.createNewBrowserInstance();
        br.setLoadLimit(br.getLoadLimit() * 2);
        br.getHeaders().put("Accept-Encoding", "gzip, deflate");
        br.setFollowRedirects(true);
        br.setCookie(this.getHost(), "lang_v2", "en_US");
        br.addAllowedResponseCodes(new int[]{500});
        br.getHeaders().put("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36");
        return br;
    }

    public static List<String[]> getPluginDomains() {
        ArrayList<String[]> ret = new ArrayList<String[]>();
        ret.add(new String[]{"filecrypt.cc", "filecrypt.co", "filecrypt.to"});
        return ret;
    }

    public static String[] getAnnotationNames() {
        return FileCryptCc.buildAnnotationNames(FileCryptCc.getPluginDomains());
    }

    public String[] siteSupportedNames() {
        return this.buildSupportedNames(FileCryptCc.getPluginDomains());
    }

    public static String[] getAnnotationUrls() {
        return FileCryptCc.buildAnnotationUrls(FileCryptCc.getPluginDomains());
    }

    public static String[] buildAnnotationUrls(List<String[]> pluginDomains) {
        ArrayList<String> ret = new ArrayList<String>();
        for (String[] domains : pluginDomains) {
            ret.add("https?://(?:www\\.)?" + FileCryptCc.buildHostsPatternPart((String[])domains) + "/Container/([A-Z0-9]{10,16})(\\.html)?(\\?mirror=\\d+)?");
        }
        return ret.toArray(new String[0]);
    }

    public boolean hasCaptcha(CryptedLink link, Account acc) {
        return true;
    }

    public ArrayList<DownloadLink> decryptIt(CryptedLink param, ProgressController progress) throws Exception {
        String[] availableMirrorurls;
        FileCryptConfig cfg = (FileCryptConfig)PluginJsonConfig.get(this.getConfigInterface());
        String contenturl = URLHelper.getUrlWithoutParams((String)param.getCryptedUrl());
        if (!StringUtils.endsWithCaseInsensitive((String)contenturl, (String)".html")) {
            contenturl = contenturl + ".html";
        }
        String contenturl_without_params = contenturl;
        String folderID = new Regex((Object)contenturl, this.getSupportedLinks()).getMatch(0);
        String mirrorIdFromAddedURL = UrlQuery.parse((String)param.getCryptedUrl()).get("mirror");
        if (mirrorIdFromAddedURL != null && !mirrorIdFromAddedURL.matches("\\d+")) {
            this.logger.info("User added URL with invalid mirror_id value (not a number) -> " + mirrorIdFromAddedURL);
            mirrorIdFromAddedURL = null;
        }
        if (mirrorIdFromAddedURL != null) {
            contenturl = contenturl + "?mirror=" + mirrorIdFromAddedURL;
        }
        this.logoPW = null;
        this.successfullyUsedFolderPassword = null;
        this.handlePasswordAndCaptcha(param, folderID, contenturl);
        ArrayList<String> extractionPasswordList = null;
        if (this.successfullyUsedFolderPassword != null || this.logoPW != null) {
            extractionPasswordList = new ArrayList<String>();
            if (this.successfullyUsedFolderPassword != null) {
                extractionPasswordList.add(this.successfullyUsedFolderPassword);
            }
            if (this.logoPW != null && !this.logoPW.equals(this.successfullyUsedFolderPassword)) {
                extractionPasswordList.add(this.logoPW);
            }
        }
        if (mirrorIdFromAddedURL != null && this.looksLikeUploaderHasDeactivatedAllMirrors(this.br)) {
            this.logger.info("Attempting workaround for misleading error message 'user has deactivated all mirrors for this folder' while maybe only the mirror_id inside the added URL is offline");
            this.getPage(contenturl_without_params);
            if (this.looksLikeUploaderHasDeactivatedAllMirrors(this.br)) {
                throw new PluginException(32);
            }
            this.logger.info("Workaround successful -> mirror_id from added url does not exist: " + mirrorIdFromAddedURL);
            mirrorIdFromAddedURL = null;
        }
        FilePackage fp = null;
        String fpName = this.br.getRegex("<h2>([^<]+)<").getMatch(0);
        if (fpName != null) {
            fp = FilePackage.getInstance();
            fp.setName(Encoding.htmlDecode((String)fpName).trim());
        }
        if ((availableMirrorurls = this.br.getRegex("\"([^\"]*/Container/[A-Z0-9]+\\.html\\?mirror=\\d+)").getColumn(0)) == null || availableMirrorurls.length == 0) {
            if (this.looksLikeUploaderHasDeactivatedAllMirrors(this.br)) {
                throw new PluginException(32);
            }
            this.logger.info("Failed to find any mirrors in html -> Looks like only one mirror is available");
            availableMirrorurls = new String[]{mirrorIdFromAddedURL != null ? contenturl : contenturl + "?mirror=0"};
        }
        ArrayList<String> mirror_urls = new ArrayList<String>();
        ArrayList<String> mirror_ids = new ArrayList<String>();
        String urlWithUserPreferredMirrorID = null;
        for (String mirrorurl : availableMirrorurls) {
            String mirror_id = UrlQuery.parse((String)mirrorurl).get("mirror");
            if (mirror_ids.contains(mirror_id)) continue;
            mirror_ids.add(mirror_id);
            if (StringUtils.equals((String)mirror_id, (String)mirrorIdFromAddedURL)) {
                this.logger.info("Found user preferred mirrorID " + mirrorIdFromAddedURL);
                urlWithUserPreferredMirrorID = mirrorurl;
            }
            mirror_urls.add(mirrorurl);
        }
        this.logger.info("Available mirrors: " + mirror_ids.size() + " | mirror_ids: " + mirror_ids);
        if (mirrorIdFromAddedURL != null && urlWithUserPreferredMirrorID == null) {
            this.logger.info("User preferred mirrorID " + mirrorIdFromAddedURL + " does not exist in list of really existing mirrors");
        }
        ArrayList<DownloadLink> ret = new ArrayList<DownloadLink>();
        int numberofOfflineMirrors = 0;
        int numberofSkippedFakeAdvertisementMirrors = 0;
        for (int mirrorindex = 0; mirrorindex < mirror_urls.size(); ++mirrorindex) {
            Browser brc;
            String mirrorurl = (String)mirror_urls.get(mirrorindex);
            String currentMirrorID = UrlQuery.parse((String)mirrorurl).get("mirror");
            this.logger.info("Crawling mirror " + (mirrorindex + 1) + "/" + mirror_urls.size() + " | MirrorID: " + currentMirrorID + " | " + mirrorurl);
            if (mirrorindex > 0) {
                this.handlePasswordAndCaptcha(param, folderID, mirrorurl);
            } else {
                this.logger.info("Do not access mirrorurl because we are currently crawling the first mirror");
            }
            boolean mirrorLooksToBeOffline = false;
            boolean mirrorLooksToBeAdvertisement = false;
            if (this.br.containsHTML("class=\"window container offline\"")) {
                this.logger.info("Mirror looks to be offline: " + mirrorurl);
                ++numberofOfflineMirrors;
                mirrorLooksToBeOffline = true;
            } else if (this.br.getURL().contains("mirror=666") && this.br.containsHTML("usenet")) {
                this.logger.info("Mirror looks to be a fake advertisement mirror: " + mirrorurl);
                mirrorLooksToBeAdvertisement = true;
            }
            boolean testDevCnlFailure = false;
            boolean testDevDLCFailure = false;
            boolean testDevRedirectLinksFailure = false;
            ArrayList<DownloadLink> thisMirrorResults = new ArrayList<DownloadLink>();
            if (thisMirrorResults.isEmpty()) {
                ArrayList<DownloadLink> cnlResults = this.handleCnl2(contenturl, this.successfullyUsedFolderPassword);
                if (cnlResults.isEmpty()) {
                    this.logger.info("Failed to find CNL results");
                } else {
                    this.logger.info("CNL success");
                    for (DownloadLink link : cnlResults) {
                        if (fp != null) {
                            link._setFilePackage(fp);
                        }
                        if (extractionPasswordList != null) {
                            link.setSourcePluginPasswordList(extractionPasswordList);
                        }
                        this.distribute(new DownloadLink[]{link});
                        thisMirrorResults.add(link);
                    }
                }
            }
            if (thisMirrorResults.isEmpty()) {
                this.logger.info("CNL failure -> Trying DLC");
                String dlc_id = this.br.getRegex("DownloadDLC\\('([^<>\"]*?)'\\)").getMatch(0);
                if (dlc_id == null && (dlc_id = this.br.getRegex("onclick=\"DownloadDLC[^\\(]*\\('([^']+)'").getMatch(0)) == null && (dlc_id = this.br.getRegex("class=\"dlcdownload\"[^>]* onclick=\"[^\\(]+\\('([^\\']+)").getMatch(0)) == null && (dlc_id = this.br.getRegex("DownloadDLC\\('([^\\']+)'\\)").getMatch(0)) == null) {
                    dlc_id = this.br.getRegex("onclick=\"DownloadDLC[^\"]+\" data-[a-zA-Z0-9]+=\"([^\"]+)").getMatch(0);
                }
                if (dlc_id == null) {
                    this.logger.info("Failed to find DLC container");
                } else {
                    this.logger.info("DLC found - trying to add it");
                    brc = this.br.cloneBrowser();
                    ArrayList dlcResults = this.loadContainerFile(brc, (Request)brc.createGetRequest("/DLC/" + dlc_id + ".dlc"), Collections.singletonMap("extension", ".dlc"));
                    if (dlcResults == null || dlcResults.isEmpty()) {
                        this.logger.warning("DLC for current mirror is empty or something is broken!");
                    } else {
                        this.logger.info("DLC success");
                        for (DownloadLink link : dlcResults) {
                            if (fp != null) {
                                link._setFilePackage(fp);
                            }
                            if (extractionPasswordList != null) {
                                link.setSourcePluginPasswordList(extractionPasswordList);
                            }
                            this.distribute(new DownloadLink[]{link});
                            thisMirrorResults.add(link);
                        }
                    }
                }
            }
            if (thisMirrorResults.isEmpty()) {
                this.logger.info("Trying single link redirect handling");
                String[] links = this.br.getRegex("<button[^<>]+\\sdata-[0-9a-z]{5,}=\"([^\"]+)").getColumn(0);
                if (links == null || links.length == 0) {
                    this.logger.info("Failed to find redirectLinks");
                } else {
                    brc = this.br.cloneBrowser();
                    brc.setFollowRedirects(false);
                    brc.setCookie(this.br.getHost(), "BetterJsPopCount", "1");
                    int index = -1;
                    HashSet<String> dupes = new HashSet<String>();
                    String[] filenames = this.br.getRegex("<td title=\"([^\"]+)\">[^<]+<span><a href=[^>]*class=\"external_link\"").getColumn(0);
                    String[] filesizes = this.br.getRegex("</a></span></td><td>(\\d+[^<]+)</td>").getColumn(0);
                    for (String singleLink : links) {
                        this.logger.info("Processing redirectLinksLoop position: " + ++index + "/" + links.length + " | " + singleLink);
                        if (!dupes.add(singleLink)) {
                            this.logger.info("Skipping dupe: " + singleLink);
                            continue;
                        }
                        String finallink = null;
                        int retryLink = 2;
                        while (!this.isAbort()) {
                            finallink = this.handleLink(brc, param, singleLink, 0);
                            if (StringUtils.equals((String)"IGNORE", (String)finallink) || finallink == null && --retryLink != 0) continue;
                            this.logger.info(singleLink + " -> " + finallink + " | " + retryLink);
                            break;
                        }
                        if (finallink == null) {
                            this.logger.warning("Failed to find any result for: " + singleLink);
                            continue;
                        }
                        DownloadLink link = this.createDownloadlink(finallink);
                        if (fp != null) {
                            link._setFilePackage(fp);
                        }
                        if (extractionPasswordList != null) {
                            link.setSourcePluginPasswordList(extractionPasswordList);
                        }
                        if (filenames != null && filenames.length == links.length) {
                            String filename = filenames[index];
                            filename = Encoding.htmlDecode((String)filename).trim();
                            link.setName(filename);
                        }
                        if (filesizes != null && filesizes.length == links.length) {
                            String filesize = filenames[index];
                            filesize = Encoding.htmlDecode((String)filesize).trim();
                            link.setDownloadSize(SizeFormatter.getSize((String)filesize));
                        }
                        thisMirrorResults.add(link);
                        this.distribute(new DownloadLink[]{link});
                        if (!this.isAbort()) continue;
                        this.logger.info("Stopping because: Aborted by user");
                        break;
                    }
                }
            }
            this.logger.info("Mirror " + currentMirrorID + " results: " + thisMirrorResults.size());
            if (thisMirrorResults.isEmpty()) {
                if (mirrorLooksToBeOffline) {
                    this.logger.info("Skipping mirror which looks to be offline: " + mirrorurl);
                    ++numberofOfflineMirrors;
                    continue;
                }
                if (mirrorLooksToBeAdvertisement) {
                    this.logger.info("Skipping fake advertisement mirror: " + mirrorurl);
                    ++numberofSkippedFakeAdvertisementMirrors;
                    continue;
                }
                this.logger.warning("Failed at mirror: " + mirrorurl);
                throw new PluginException(0x400000);
            }
            ret.addAll(thisMirrorResults);
            if (cfg.getCrawlMode() != FileCryptConfig.CrawlMode.PREFER_GIVEN_MIRROR_ID || mirrorIdFromAddedURL == null || !currentMirrorID.equals(mirrorIdFromAddedURL)) continue;
            this.logger.info("Stopping because: Found user desired mirror: " + mirrorIdFromAddedURL);
            break;
        }
        if (ret.isEmpty()) {
            if (numberofOfflineMirrors == mirror_urls.size() - numberofSkippedFakeAdvertisementMirrors) {
                this.logger.info("All mirrors are offline and only fake mirrors/usenet/ads exist -> Whole folder is offline");
                throw new PluginException(32);
            }
            if (numberofOfflineMirrors == mirror_urls.size() - numberofSkippedFakeAdvertisementMirrors) {
                this.logger.info("All mirrors are offline -> Whole folder is offline");
                throw new PluginException(32);
            }
            throw new PluginException(0x400000);
        }
        return ret;
    }

    private boolean looksLikeUploaderHasDeactivatedAllMirrors(Browser br) {
        if (br.containsHTML(">\\s*Der Inhaber dieses Ordners hat leider alle Hoster in diesem Container in seinen Einstellungen deaktiviert")) {
            return true;
        }
        return br.containsHTML(">\\s*The owner of this folder has deactivated all hosts in this container in their settings");
    }

    private boolean handlePassword(CryptedLink param) throws Exception {
        List passwords = this.getPreSetPasswords();
        HashSet<String> usedWrongPasswords = new HashSet<String>();
        int passwordCounter = 0;
        int maxPasswordRetries = 3;
        String[] possiblePasswordFieldKeys = new String[]{"password", "pssw", "password__"};
        String logoPassword = this.initializeLogoPassword();
        if (logoPassword != null) {
            passwords.add(0, logoPassword);
        }
        while (true) {
            if (++passwordCounter > 3) break;
            this.logger.info("Password attempt: " + passwordCounter + " / " + 3);
            Form passwordForm = this.findPasswordForm(possiblePasswordFieldKeys);
            if (passwordForm == null) {
                throw new PluginException(0x400000, "Failed to find password Form");
            }
            String passwordFieldKey = this.getPasswordFieldKey(passwordForm, possiblePasswordFieldKeys);
            if (StringUtils.isEmpty((String)passwordFieldKey)) {
                throw new PluginException(0x400000, "passwordFieldKey can't be empty");
            }
            String passCode = this.getNextPassword(passwords, usedWrongPasswords);
            if (passCode == null) {
                passCode = this.getUserInput("Password?", param);
                if (StringUtils.isEmpty((String)passCode)) {
                    throw new DecrypterException(DecrypterException.PASSWORD);
                }
                if (usedWrongPasswords.contains(passCode)) {
                    this.logger.info("Skipping user-entered already tried wrong password: " + passCode);
                    continue;
                }
            }
            passwordForm.put(passwordFieldKey, Encoding.urlEncode((String)passCode));
            this.submitForm(passwordForm);
            if (!this.containsPassword(this.cleanHTML)) {
                this.logger.info("Password success: " + passCode);
                this.successfullyUsedFolderPassword = passCode;
                if (!StringUtils.equals((String)this.getPluginConfig().getStringProperty(PROPERTY_PLUGIN_LAST_USED_PASSWORD), (String)this.successfullyUsedFolderPassword)) {
                    this.logger.info("Saving correct password for future usage: " + this.successfullyUsedFolderPassword);
                }
                this.getPluginConfig().setProperty(PROPERTY_PLUGIN_LAST_USED_PASSWORD, (Object)this.successfullyUsedFolderPassword);
                return true;
            }
            this.logger.info("Password failure | Wrong password: " + passCode);
            usedWrongPasswords.add(passCode);
        }
        this.logger.info("Stopping because: Too many wrong password attempts");
        if (passwordCounter >= 3 && this.containsPassword(this.cleanHTML)) {
            throw new DecrypterException(DecrypterException.PASSWORD);
        }
        return false;
    }

    private String initializeLogoPassword() {
        if (this.logoPW != null) {
            return this.logoPW;
        }
        String customLogoID = this.br.getRegex("(?:logo|custom)/([a-z0-9]+)\\.png").getMatch(0);
        if (customLogoID != null) {
            String password = this.getLogoPassword(customLogoID);
            if (password != null) {
                this.logger.info("Found possible PW by logoID: " + password);
                this.logoPW = password;
                return password;
            }
            this.logger.info("Found unknown logoID: " + customLogoID);
            return null;
        }
        this.logger.info("Failed to find logoID via regex, trying fallback method");
        for (String logoID : this.LOGO_PASSWORD_MAP().keySet()) {
            if (!this.br.containsHTML("/" + logoID + "\\.png")) continue;
            String password = this.getLogoPassword(logoID);
            this.logger.info("Found logoID via fallback search: " + logoID + " | LogoPW: " + password);
            this.logoPW = password;
            return password;
        }
        this.logger.info("Failed to find logoID via fallback method");
        return null;
    }

    private Map<String, String> LOGO_PASSWORD_MAP() {
        if (this.LOGO_PASSWORD_MAP.size() == 0) {
            String pw_sfans = "serienfans.org";
            this.LOGO_PASSWORD_MAP.put("53d1b", "serienfans.org");
            this.LOGO_PASSWORD_MAP.put("80d13", "serienfans.org");
            this.LOGO_PASSWORD_MAP.put("fde1d", "serienfans.org");
            this.LOGO_PASSWORD_MAP.put("8abe0", "serienfans.org");
            this.LOGO_PASSWORD_MAP.put("8f073", "serienfans.org");
            this.LOGO_PASSWORD_MAP.put("48544", "serienfans.org");
            this.LOGO_PASSWORD_MAP.put("975e4", "filmfans.org");
            this.LOGO_PASSWORD_MAP.put("51967", "kellerratte");
            this.LOGO_PASSWORD_MAP.put("aaf75", "cs.rin.ru");
            this.LOGO_PASSWORD_MAP.put("f38ed", "funxd");
            this.LOGO_PASSWORD_MAP.put("6c6cd", "steamrip");
        }
        return this.LOGO_PASSWORD_MAP;
    }

    private String getLogoPassword(String customLogoID) {
        if (customLogoID == null) {
            return null;
        }
        return this.LOGO_PASSWORD_MAP().get(customLogoID);
    }

    private Form findPasswordForm(String[] possiblePasswordFieldKeys) {
        Form[] allForms = this.br.getForms();
        if (allForms == null || allForms.length == 0) {
            return null;
        }
        for (int i = 0; i < allForms.length; ++i) {
            Form aForm = allForms[i];
            for (int j = 0; j < possiblePasswordFieldKeys.length; ++j) {
                if (!aForm.hasInputFieldByName(possiblePasswordFieldKeys[j])) continue;
                this.logger.info("Found password form by hasInputFieldByName(passwordFieldKey) | passwordFieldKey = " + possiblePasswordFieldKeys[j]);
                return aForm;
            }
        }
        return null;
    }

    private String getPasswordFieldKey(Form passwordForm, String[] possiblePasswordFieldKeys) {
        for (int i = 0; i < possiblePasswordFieldKeys.length; ++i) {
            if (!passwordForm.hasInputFieldByName(possiblePasswordFieldKeys[i])) continue;
            return possiblePasswordFieldKeys[i];
        }
        return null;
    }

    private String getNextPassword(List<String> passwords, HashSet<String> usedWrongPasswords) {
        while (passwords.size() > 0) {
            String pw = passwords.remove(0);
            if (!usedWrongPasswords.contains(pw)) {
                return pw;
            }
            this.logger.info("Skipping already tried wrong password: " + pw);
        }
        return null;
    }

    private void handlePasswordAndCaptcha(CryptedLink param, String folderID, String url) throws Exception {
        String host = this.br.getRequest() != null ? this.br.getHost() : Browser.getHost((String)url);
        this.br.setCookie(host, "lang", "en");
        this.getPage(url);
        if (this.br.getHttpConnection().getResponseCode() == 404) {
            throw new PluginException(32);
        }
        if (this.br.getURL().matches("(?i)https?://[^/]+/404\\.html.*")) {
            throw new PluginException(32);
        }
        if (this.br.containsHTML(">\\s*Dieser Ordner enth\u00e4lt keine Mirror")) {
            throw new PluginException(32);
        }
        if (this.containsPassword(this.cleanHTML)) {
            this.handlePassword(param);
        }
        if (!this.containsCaptcha(this.cleanHTML)) {
            this.logger.info("Looks like no captcha is required");
            return;
        }
        this.logger.info("Looks like a captcha is required");
        int captchaCounter = -1;
        int maxCaptchaRetries = 10;
        while (captchaCounter++ < 10 && !this.isAbort()) {
            this.logger.info("Captcha loop: " + captchaCounter + "/" + 10);
            Form captchaForm = null;
            Form[] forms = this.br.getForms();
            if (forms != null && forms.length != 0) {
                for (Form form : forms) {
                    if (form.containsHTML("captcha") || AbstractRecaptchaV2.containsRecaptchaV2Class((Form)form)) {
                        captchaForm = form;
                        break;
                    }
                    if (!form.containsHTML("cform")) continue;
                    captchaForm = form;
                    break;
                }
            }
            if (captchaForm == null) {
                throw new PluginException(0x400000, "Failed to find captchaForm");
            }
            String captchaURL = captchaForm.getRegex("((https?://[^<>\"']*?)?/captcha/[^<>\"']*?)\"").getMatch(0);
            if (captchaURL != null && this.containsCircleCaptcha(captchaURL)) {
                ClickedPoint cp = this.getCaptchaClickedPoint(this.getHost(), this.getCaptchaImage(captchaURL), param, "Click on the open circle");
                if (cp == null) {
                    throw new PluginException(8);
                }
                InputField button = captchaForm.getInputFieldByType(InputField.InputType.IMAGE.name());
                if (button == null) {
                    throw new PluginException(0x400000);
                }
                captchaForm.removeInputField(button);
                captchaForm.put(button.getKey() + ".x", String.valueOf(cp.getX()));
                captchaForm.put(button.getKey() + ".y", String.valueOf(cp.getY()));
            } else if (captchaForm != null && captchaForm.containsHTML("=\"g-recaptcha\"")) {
                String recaptchaV2Response = new CaptchaHelperCrawlerPluginRecaptchaV2((PluginForDecrypt)this, this.br).getToken();
                captchaForm.put("g-recaptcha-response", Encoding.urlEncode((String)recaptchaV2Response));
            } else if (StringUtils.containsIgnoreCase((String)captchaURL, (String)"cutcaptcha")) {
                this.logger.info("Attempting to solve CutCaptcha");
                String cutcaptchaToken = new CaptchaHelperCrawlerPluginCutCaptcha((PluginForDecrypt)this, this.br, null).getToken();
                captchaForm.put("cap_token", Encoding.urlEncode((String)cutcaptchaToken));
            } else {
                if (this.br.containsHTML("/js/pow_captcha\\.js") && this.br.containsHTML("name=\"pow_")) {
                    throw new DecrypterRetryException(DecrypterRetryException.RetryReason.UNSUPPORTED_CAPTCHA, "Unsupported captcha type 'powcaptcha.com'");
                }
                String code = this.getCaptchaCode(captchaURL, param);
                captchaForm.put("recaptcha_response_field", Encoding.urlEncode((String)code));
            }
            this.submitForm(captchaForm);
            if (this.containsCaptcha(this.cleanHTML)) {
                this.logger.info("User entered wrong captcha");
                this.invalidateLastChallengeResponse();
                continue;
            }
            this.logger.info("User entered correct captcha");
            this.validateLastChallengeResponse();
            return;
        }
        throw new DecrypterRetryException(DecrypterRetryException.RetryReason.CAPTCHA);
    }

    private String handleLink(Browser br, CryptedLink param, String singleLink, int round) throws Exception {
        if (round >= 5) {
            throw new PluginException(0x400000);
        }
        String domainPattern = FileCryptCc.buildHostsPatternPart((String[])FileCryptCc.getPluginDomains().get(0));
        if (StringUtils.startsWithCaseInsensitive((String)singleLink, (String)"http://") || StringUtils.startsWithCaseInsensitive((String)singleLink, (String)"https://")) {
            br.getPage(singleLink);
        } else {
            br.getPage("/Link/" + singleLink + ".html");
        }
        if (br.containsHTML("friendlyduck\\.com/") || br.containsHTML(domainPattern + "/usenet\\.html") || br.containsHTML("powerusenet.xyz")) {
            return "IGNORE";
        }
        int retryCaptcha = 5;
        while (!this.isAbort() && retryCaptcha-- > 0 && this.containsCaptcha(br.getRequest().getHtmlCode())) {
            String captcha = br.getRegex("(/captcha/[^<>\"]*?)\"").getMatch(0);
            if (captcha == null || !captcha.contains("circle.php")) {
                this.logger.warning("Unsupported/unexpected captcha for single redirect link.");
                throw new PluginException(0x400000);
            }
            ClickedPoint cp = this.getCaptchaClickedPoint(this.getHost(), this.getCaptchaImage(captcha), param, "Click on the open circle");
            if (cp == null) {
                throw new PluginException(8);
            }
            Form form = new Form();
            form.setMethod(Form.MethodType.POST);
            form.setAction(br.getURL());
            form.put("button.x", String.valueOf(cp.getX()));
            form.put("button.y", String.valueOf(cp.getY()));
            form.put("button", "send");
            br.submitForm(form);
        }
        String finallink = null;
        String first_rd = br.getRedirectLocation();
        if (first_rd != null && first_rd.matches(".*" + domainPattern + "/.*")) {
            return this.handleLink(br, param, first_rd, round + 1);
        }
        if (first_rd != null && !first_rd.matches(".*" + domainPattern + "/.*")) {
            finallink = first_rd;
        } else {
            String nextlink = br.getRegex("(\"|')(https?://[^/]+/index\\.php\\?Action=(G|g)o[^<>\"']+)").getMatch(1);
            if (nextlink == null) {
                nextlink = br.getRegex("(\"|')(https?://[^/]+/Go/[^<>\"']+)").getMatch(1);
            }
            if (nextlink != null) {
                return this.handleLink(br, param, nextlink, round + 1);
            }
        }
        if (finallink == null) {
            return null;
        }
        if (this.canHandle(finallink)) {
            return null;
        }
        return finallink;
    }

    private ArrayList<DownloadLink> handleCnl2(String url, String password) throws Exception {
        Object infos;
        ArrayList<DownloadLink> ret = new ArrayList<DownloadLink>();
        Form[] forms = this.br.getForms();
        Form CNLPOP = null;
        for (Form f : forms) {
            if (!f.containsHTML("CNLPOP") && !f.containsHTML("cnlform")) continue;
            CNLPOP = f;
            break;
        }
        Form cnl = null;
        if (CNLPOP != null) {
            infos = CNLPOP.getRegex("'(.*?)'").getColumn(0);
            cnl = new Form();
            cnl.addInputField(new InputField("crypted", (String)infos[2]));
            cnl.addInputField(new InputField("jk", "function f(){ return '" + (String)infos[1] + "';}"));
            cnl.addInputField(new InputField("source", null));
        } else {
            for (Form f : forms) {
                if (!f.hasInputFieldByName("jk")) continue;
                cnl = f;
                break;
            }
        }
        if (cnl == null) {
            return ret;
        }
        infos = new HashMap();
        infos.put("crypted", Encoding.urlDecode((String)cnl.getInputField("crypted").getValue(), (boolean)false));
        infos.put("jk", Encoding.urlDecode((String)cnl.getInputField("jk").getValue(), (boolean)false));
        String source = cnl.getInputField("source").getValue();
        if (StringUtils.isEmpty((String)source)) {
            source = url;
        } else {
            infos.put("source", source);
        }
        infos.put("source", source);
        if (password != null) {
            infos.put("passwords", password);
        }
        String json = JSonStorage.serializeToJson((Object)infos);
        DownloadLink dl = this.createDownloadlink("http://dummycnl.jdownloader.org/" + HexFormatter.byteArrayToHex((byte[])json.getBytes("UTF-8")));
        ret.add(dl);
        return ret;
    }

    private final boolean containsCaptcha(String html) {
        if (new Regex(html, ">\\s*(?:Sicherheits\u00fcberpr\u00fcfung|Security prompt|Security check)\\s*</").patternFind()) {
            return true;
        }
        return this.containsCircleCaptcha(html);
    }

    private final boolean containsCircleCaptcha(String str) {
        return StringUtils.containsIgnoreCase((String)str, (String)"circle.php");
    }

    private final boolean containsPassword(String html) {
        return new Regex(html, "(?i)>\\s*(?:Passwort erforderlich|Password required)\\s*</").patternFind();
    }

    private final void cleanUpHTML(Browser br) {
        String toClean = br.getRequest().getHtmlCode();
        ArrayList<String> regexStuff = new ArrayList<String>();
        regexStuff.add("<!(--.*?--)>");
        regexStuff.add("(<\\s*(\\w+)\\s+[^>]*style\\s*=\\s*(\"|')(?:(?:[\\w:;\\s#-]*(visibility\\s*:\\s*hidden;|display\\s*:\\s*none;|font-size\\s*:\\s*0;)[\\w:;\\s#-]*)|font-size\\s*:\\s*0|visibility\\s*:\\s*hidden|display\\s*:\\s*none)\\3[^>]*(>.*?<\\s*/\\2[^>]*>|/\\s*>))");
        for (String aRegex : regexStuff) {
            String[] results = new Regex(toClean, aRegex).getColumn(0);
            if (results == null) continue;
            for (String result : results) {
                toClean = toClean.replace(result, "");
            }
        }
        this.cleanHTML = toClean;
    }

    private final void getPage(String page) throws Exception {
        if (page == null) {
            throw new PluginException(0x400000);
        }
        this.br.getPage(page);
        this.cleanUpHTML(this.br);
    }

    private final void postPage(String url, String post) throws Exception {
        if (url == null || post == null) {
            throw new PluginException(0x400000);
        }
        this.br.postPage(url, post);
        this.cleanUpHTML(this.br);
    }

    private final void submitForm(Form form) throws Exception {
        if (form == null) {
            throw new PluginException(0x400000);
        }
        this.br.submitForm(form);
        this.cleanUpHTML(this.br);
    }

    public Class<? extends FileCryptConfig> getConfigInterface() {
        return FileCryptConfig.class;
    }
}
